"""API tải lên, xem, phát và xoá video.

POST   /uploads                 tải video lên (multipart, có thể kèm project_id), đọc metadata bằng ffprobe
GET    /uploads                 danh sách video, mới nhất trước
GET    /uploads/{id}            thông tin một video, đọc bổ sung metadata / tạo bản xem nếu thiếu
POST   /uploads/{id}/proxy      tạo lại bản xem MP4 khi lần trước bị lỗi
GET    /uploads/{id}/video      phát video (bản xem MP4 nếu có, không thì file gốc)
DELETE /uploads/{id}            xoá video, bản xem và nhãn đi kèm
"""

import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse

from app.api.deps import get_annotation_store, get_project_store, get_upload_store
from app.core.config import settings
from app.schemas.upload import Upload, VideoGroup
from app.services.annotation_store import AnnotationStore
from app.services.project_store import ProjectStore
from app.services.upload_store import UploadStore
from app.services.video_probe import InvalidVideoError, probe_video
from app.services.video_proxy import is_running, needs_proxy, proxy_path, run_proxy_job

router = APIRouter(prefix="/uploads")

# Ghi file theo từng khối 1 MB để không phải đọc cả video (có thể vài GB) vào RAM
CHUNK_SIZE = 1024 * 1024

MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
}


def _save_with_limit(file: UploadFile, destination: Path, max_bytes: int) -> int:
    """Ghi file tải lên xuống đĩa, dừng ngay khi vượt giới hạn. Lỗi giữa chừng thì xoá file dở."""
    written = 0
    try:
        with destination.open("wb") as out:
            while chunk := file.file.read(CHUNK_SIZE):
                written += len(chunk)
                if written > max_bytes:
                    raise HTTPException(
                        status.HTTP_413_CONTENT_TOO_LARGE,
                        f"Video vượt quá giới hạn {settings.MAX_UPLOAD_SIZE_MB} MB.",
                    )
                out.write(chunk)
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return written


def _schedule_proxy(upload: Upload, store: UploadStore, background: BackgroundTasks) -> Upload:
    """Đánh dấu đang tạo bản xem và chạy chuyển đổi sau khi trả response."""
    if upload.proxy_status != "processing":
        upload = upload.model_copy(update={"proxy_status": "processing", "proxy_error": None})
        store.update(upload)
    background.add_task(run_proxy_job, store, upload.id)
    return upload


# Dependency: lấy video theo upload_id trên đường dẫn, không có thì trả 404.
# Các endpoint khác (nhãn, phân loại) cũng dùng lại hàm này.
def get_upload_or_404(upload_id: str, store: UploadStore = Depends(get_upload_store)) -> Upload:
    upload = store.get(upload_id)
    if upload is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy video.")
    return upload


@router.get("", response_model=list[Upload])
def list_uploads(store: UploadStore = Depends(get_upload_store)):
    return store.list()


@router.post("", response_model=Upload, status_code=status.HTTP_201_CREATED)
def upload_video(
    file: UploadFile,
    background: BackgroundTasks,
    suggested_group: VideoGroup | None = Form(None),
    project_id: str | None = Form(None),
    store: UploadStore = Depends(get_upload_store),
    projects: ProjectStore = Depends(get_project_store),
):
    # Kiểm tra project trước khi chép video vào thư mục lưu trữ
    if project_id is not None and projects.get(project_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy project.")

    name = Path(file.filename or "").name
    extension = Path(name).suffix.lower()
    if extension not in settings.ALLOWED_VIDEO_EXTENSIONS:
        allowed = ", ".join(sorted(settings.ALLOWED_VIDEO_EXTENSIONS))
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Định dạng '{extension or 'không rõ'}' không được hỗ trợ. Chỉ nhận: {allowed}.",
        )

    # Lưu file theo id ngẫu nhiên thay vì tên gốc để hai video trùng tên không ghi đè nhau
    upload_id = uuid.uuid4().hex
    stored_as = f"{upload_id}{extension}"
    destination = store.upload_dir / stored_as
    size = _save_with_limit(file, destination, settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024)

    # ffprobe không đọc được thì coi là file hỏng / không phải video: xoá và báo lỗi
    try:
        info = probe_video(destination)
    except InvalidVideoError as error:
        destination.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from error

    upload = Upload(
        id=upload_id,
        name=name,
        size=size,
        stored_as=stored_as,
        created_at=datetime.now(timezone.utc),
        suggested_group=suggested_group,
        project_id=project_id,
        **asdict(info),
    )
    store.add(upload)
    # Video trình duyệt không phát được (ví dụ .avi MJPEG) thì chuyển nền sang MP4
    if needs_proxy(upload):
        upload = _schedule_proxy(upload, store, background)
    return upload


@router.get("/{upload_id}", response_model=Upload)
def get_upload(
    background: BackgroundTasks,
    upload: Upload = Depends(get_upload_or_404),
    store: UploadStore = Depends(get_upload_store),
):
    # Video tải lên trước khi có trường fps / codec thì đọc bổ sung một lần
    if upload.fps is None or upload.codec is None:
        try:
            info = probe_video(store.upload_dir / upload.stored_as)
        except InvalidVideoError:
            return upload
        if info.fps is not None:
            upload = upload.model_copy(update=asdict(info))
            store.update(upload)

    # Video cũ chưa có bản xem, hoặc máy chủ khởi động lại khi đang chuyển đổi dở
    missing = upload.proxy_status is None and needs_proxy(upload)
    interrupted = upload.proxy_status == "processing" and not is_running(upload.id)
    if missing or interrupted:
        upload = _schedule_proxy(upload, store, background)
    return upload


@router.post("/{upload_id}/proxy", response_model=Upload)
def retry_proxy(
    background: BackgroundTasks,
    upload: Upload = Depends(get_upload_or_404),
    store: UploadStore = Depends(get_upload_store),
):
    """Tạo lại bản xem, dùng khi lần chuyển đổi trước bị lỗi."""
    if not needs_proxy(upload):
        raise HTTPException(status.HTTP_409_CONFLICT, "Video này phát được trực tiếp, không cần chuyển định dạng.")
    if is_running(upload.id):
        return upload
    return _schedule_proxy(upload, store, background)


@router.get("/{upload_id}/video")
def stream_video(
    upload: Upload = Depends(get_upload_or_404),
    store: UploadStore = Depends(get_upload_store),
):
    path = store.upload_dir / upload.stored_as
    proxy = proxy_path(store.upload_dir, upload.id)
    if upload.proxy_status == "ready" and proxy.exists():
        path = proxy
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File video không còn trên máy chủ.")
    media_type = MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")
    # FileResponse hỗ trợ HTTP Range, nên trình duyệt tua được mà không phải tải cả file
    return FileResponse(path, media_type=media_type)


@router.delete("/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_upload(
    upload_id: str,
    store: UploadStore = Depends(get_upload_store),
    annotations: AnnotationStore = Depends(get_annotation_store),
):
    if remove_upload(store, annotations, upload_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy video.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def remove_upload(store: UploadStore, annotations: AnnotationStore, upload_id: str) -> Upload | None:
    """Xoá bản ghi, file gốc, bản xem MP4 và nhãn của một video. Không có video thì trả None.

    Dùng chung cho xoá một video và xoá cả project.
    """
    removed = store.delete(upload_id)
    if removed is not None:
        proxy_path(store.upload_dir, upload_id).unlink(missing_ok=True)
        annotations.delete(upload_id)
    return removed
