"""API auto label: tự đề xuất người đang sử dụng máy tính cho một video (xem doc/auto-label.md).

GET  /autolabel/models          các model chọn được (YOLO26s, YOLO26x...), model mặc định đứng đầu
POST /uploads/{id}/autolabel   bắt đầu chạy nền cho một video (body tuỳ chọn: {"model": "yolo26x.pt"})
GET  /uploads/{id}/autolabel   trạng thái, tiến độ lần chạy gần nhất

Kết quả được ghi vào file nhãn dưới dạng track origin=auto, confirmed=false. Người gán
phải chấp nhận hoặc sửa từng track thì mới khoá GT được.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from app.api.deps import get_annotation_store, get_upload_store
from app.api.v1.endpoints.uploads import get_upload_or_404
from app.core.config import settings
from app.schemas.autolabel import AutoLabelIn, AutoLabelJob, AutoLabelModel
from app.schemas.upload import Upload
from app.services.annotation_store import AnnotationStore
from app.services.autolabel import detector, jobs
from app.services.upload_store import UploadStore

# Không đặt prefix /uploads: /autolabel/models mà nằm dưới /uploads thì bị /uploads/{upload_id} bắt mất
router = APIRouter()


@router.get("/autolabel/models", response_model=list[AutoLabelModel])
def autolabel_models():
    return detector.list_models()


@router.get("/uploads/{upload_id}/autolabel", response_model=AutoLabelJob)
def autolabel_status(upload: Upload = Depends(get_upload_or_404)):
    return jobs.get_job(upload.id)


@router.post("/uploads/{upload_id}/autolabel", response_model=AutoLabelJob, status_code=status.HTTP_202_ACCEPTED)
def start_autolabel(
    background: BackgroundTasks,
    data: AutoLabelIn | None = None,
    upload: Upload = Depends(get_upload_or_404),
    uploads: UploadStore = Depends(get_upload_store),
    annotations: AnnotationStore = Depends(get_annotation_store),
):
    if not detector.is_available():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Máy chủ chưa cài thư viện auto label. Chạy: pip install -r requirements-autolabel.txt",
        )
    if not (upload.fps and upload.duration and upload.width and upload.height):
        raise HTTPException(status.HTTP_409_CONFLICT, "Chưa đọc được fps, thời lượng hoặc kích thước của video.")
    if jobs.has_human_work(annotations.get(upload.id)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Video đã có nhãn do người gán. Auto label chỉ chạy trên video chưa gán, "
            "hoặc chỉ có nhãn auto chưa xác nhận (sẽ được thay bằng kết quả mới).",
        )

    model_file = (data.model if data else None) or detector.default_model()
    if model_file not in {m["id"] for m in detector.list_models()}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Không có model auto label '{model_file}'.")

    queued = jobs.queue_job(upload.id, model_file)
    if queued is None:
        # Đang chờ hoặc đang chạy rồi thì trả trạng thái hiện tại, không chạy thêm lần nữa
        return jobs.get_job(upload.id)
    background.add_task(
        jobs.run_job, upload.id, uploads, annotations, settings.AUTOLABEL_SAMPLES_PER_SECOND, model_file=model_file
    )
    return queued
