"""API tạo ground truth (bước 4 của luồng QC).

GET  /gt/readiness             kiểm tra từng video đã phân loại có đủ điều kiện vào GT không
GET  /gt/preview/{upload_id}   GT của một video dựng từ nhãn hiện tại (panel GT ở trang Gán nhãn)
GET  /gt                       danh sách version đã khoá
POST /gt                       khoá version mới từ các video được chọn
GET  /gt/{version}             nội dung một version
GET  /gt/{version}/download    tải file JSON của một version

Nội dung GT được dựng trong services/gt_builder.py, lưu trong services/gt_store.py.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.api.deps import get_annotation_store, get_gt_store, get_upload_store
from app.schemas.gt import GtCreate, GtPreview, GtReadiness, GtVersion, GtVersionInfo
from app.services.annotation_store import AnnotationStore
from app.services.gt_builder import build_version, build_video, check_video, total_frames
from app.services.gt_store import GtStore
from app.services.upload_store import UploadStore

router = APIRouter(prefix="/gt")


@router.get("/readiness", response_model=GtReadiness)
def readiness(
    uploads: UploadStore = Depends(get_upload_store),
    annotations: AnnotationStore = Depends(get_annotation_store),
):
    """Kiểm tra từng video đã phân loại trước khi khoá GT."""
    all_uploads = uploads.list()
    return GtReadiness(
        videos=[check_video(u, annotations.get(u.id)) for u in all_uploads if u.group],
        unclassified_count=sum(1 for u in all_uploads if not u.group),
    )


@router.get("/preview/{upload_id}", response_model=GtPreview)
def preview_video(
    upload_id: str,
    frame_step: int = Query(5, ge=1, le=1000),
    uploads: UploadStore = Depends(get_upload_store),
    annotations: AnnotationStore = Depends(get_annotation_store),
):
    """Phần GT của một video nếu khoá ngay bây giờ, để xem trong lúc gán nhãn."""
    upload = uploads.get(upload_id)
    if upload is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy video.")
    if not upload.group:
        raise HTTPException(status.HTTP_409_CONFLICT, "Video chưa phân loại nên chưa có GT. Hãy phân loại ở trang Phân loại.")
    if total_frames(upload) is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Chưa đọc được fps hoặc thời lượng của video.")

    annotation = annotations.get(upload_id)
    check = check_video(upload, annotation)
    return GtPreview(
        frame_step=frame_step,
        eligible=check.eligible,
        issues=check.issues,
        video=build_video(upload, annotation, frame_step),
    )


@router.get("", response_model=list[GtVersionInfo])
def list_versions(store: GtStore = Depends(get_gt_store)):
    return store.list()


@router.post("", response_model=GtVersionInfo, status_code=status.HTTP_201_CREATED)
def create_version(
    data: GtCreate,
    store: GtStore = Depends(get_gt_store),
    uploads: UploadStore = Depends(get_upload_store),
    annotations: AnnotationStore = Depends(get_annotation_store),
):
    by_id = {u.id: u for u in uploads.list()}
    ids = list(dict.fromkeys(data.upload_ids))
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Không tìm thấy {len(missing)} video: {', '.join(missing)}.")

    unclassified = [by_id[i].name for i in ids if not by_id[i].group]
    if unclassified:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Video chưa phân loại: {', '.join(unclassified)}.")

    # Đọc nhãn một lần rồi dùng cho cả kiểm tra lẫn tạo GT
    selected = [(by_id[i], annotations.get(i)) for i in ids]
    blocked = [check for check in (check_video(u, a) for u, a in selected) if not check.eligible]
    if blocked:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{len(blocked)} video chưa đủ điều kiện: {', '.join(c.name for c in blocked)}.",
        )

    videos = [build_video(u, a, data.frame_step) for u, a in selected]
    # Số version (v1, v2...) do store cấp bên trong lock để hai request cùng lúc không trùng số
    gt = store.create(lambda version: build_version(version, videos, data.frame_step, data.note))
    return GtVersionInfo.model_validate(gt.model_dump(exclude={"videos"}))


def _gt_path_or_404(version: str, store: GtStore):
    path = store.path(version)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Không tìm thấy GT {version}.")
    return path


@router.get("/{version}", response_model=GtVersion)
def get_version(version: str, store: GtStore = Depends(get_gt_store)):
    _gt_path_or_404(version, store)
    return store.get(version)


@router.get("/{version}/download")
def download_version(version: str, store: GtStore = Depends(get_gt_store)):
    path = _gt_path_or_404(version, store)
    return FileResponse(path, media_type="application/json", filename=f"gt_{version}.json")
