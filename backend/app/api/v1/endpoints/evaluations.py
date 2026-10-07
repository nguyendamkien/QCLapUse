"""API đánh giá model (bước 5) và báo cáo (bước 6).

POST   /evaluations/run                         chạy model đã tải lên qua video của project rồi chấm (chạy nền)
GET    /evaluations/jobs                        các lần chạy model trong nền (?project_id=)
GET    /evaluations/jobs/{job_id}               tiến độ một lần chạy; xong thì có run_id
POST   /evaluations                             chấm từ file kết quả JSON có sẵn (multipart)
GET    /evaluations                             danh sách lượt đánh giá, mới nhất trước (?project_id=)
GET    /evaluations/{id}                        kết quả đầy đủ của một lượt
GET    /evaluations/{id}/download               tải kết quả dạng JSON
PATCH  /evaluations/{id}/videos/{upload_id}     phân loại lỗi của một video: do nhãn hay do model
PATCH  /evaluations/{id}/report                 sửa nhận xét, duyệt báo cáo
DELETE /evaluations/{id}                        xoá lượt đánh giá

GT dựng từ nhãn hiện tại của project lúc chạy và được chụp lại trong kết quả, nên sửa nhãn
sau đó không làm đổi kết quả cũ. Cách chấm xem services/evaluator.py.
"""

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import ValidationError

from app.api.deps import (
    get_annotation_store,
    get_eval_model_store,
    get_eval_store,
    get_project_store,
    get_upload_store,
)
from app.api.v1.endpoints.eval_models import require_model_library
from app.core.config import settings
from app.schemas.evaluation import (
    EvalJob,
    EvalParams,
    EvalRun,
    EvalRunIn,
    EvalRunInfo,
    PredictionFile,
    ReportIn,
    VideoReviewIn,
)
from app.services.annotation_store import AnnotationStore
from app.services import eval_jobs
from app.services.eval_model_store import EvalModelStore
from app.services.eval_store import EvalStore
from app.services.evaluator import run_evaluation
from app.services.project_store import ProjectStore
from app.services.upload_store import UploadStore

router = APIRouter(prefix="/evaluations")


def _read_prediction(file: UploadFile) -> PredictionFile:
    limit = settings.MAX_PREDICTION_SIZE_MB * 1024 * 1024
    raw = file.file.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE, f"File dự đoán vượt quá {settings.MAX_PREDICTION_SIZE_MB} MB."
        )
    try:
        return PredictionFile.model_validate(json.loads(raw))
    except json.JSONDecodeError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"File dự đoán không phải JSON hợp lệ: {error.msg} (dòng {error.lineno})."
        ) from error
    except ValidationError as error:
        first = error.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"File dự đoán sai định dạng ở {where}: {first['msg']}. Xem định dạng ở README, mục Đánh giá model.",
        ) from error


def _run_or_404(run_id: str, store: EvalStore) -> EvalRun:
    run = store.get(run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lượt đánh giá.")
    return run


# Các route /jobs phải khai báo trước /{run_id}, nếu không "jobs" bị hiểu là id lượt đánh giá
@router.post("/run", response_model=EvalJob, status_code=status.HTTP_202_ACCEPTED)
def start_model_run(
    data: EvalRunIn,
    background: BackgroundTasks,
    projects: ProjectStore = Depends(get_project_store),
    models: EvalModelStore = Depends(get_eval_model_store),
    uploads: UploadStore = Depends(get_upload_store),
    annotations: AnnotationStore = Depends(get_annotation_store),
    store: EvalStore = Depends(get_eval_store),
):
    require_model_library()
    project = projects.get(data.project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy project.")
    model = models.get(data.model_id)
    if model is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy model.")
    unknown = [c for c in data.classes or [] if c not in model.classes.values()]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Model không có lớp: {', '.join(unknown)}.")

    project_uploads = [u for u in uploads.list() if u.project_id == project.id]
    if not eval_jobs.eligible_uploads(project_uploads, annotations.get):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Project chưa có video nào đủ điều kiện để chấm. Cần phân loại và gán nhãn xong trước.",
        )

    job = eval_jobs.create(project.id, model.name)
    background.add_task(
        eval_jobs.run_job,
        job.id,
        request=data,
        model_name=model.name,
        model_path=models.path(model),
        model_filename=model.filename,
        project_name=project.name,
        uploads=project_uploads,
        upload_dir=uploads.upload_dir,
        get_annotation=annotations.get,
        store=store,
    )
    return job


@router.get("/jobs", response_model=list[EvalJob])
def list_jobs(project_id: str | None = None):
    return eval_jobs.list_jobs(project_id)


@router.get("/jobs/{job_id}", response_model=EvalJob)
def get_job(job_id: str):
    job = eval_jobs.get(job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lần chạy này (máy chủ có thể đã khởi động lại).")
    return job


@router.post("", response_model=EvalRun, status_code=status.HTTP_201_CREATED)
def create_evaluation(
    file: UploadFile,
    project_id: str = Form(),
    name: str | None = Form(None),
    iou_threshold: float = Form(0.5),
    score_threshold: float = Form(0.5),
    frame_step: int = Form(5),
    min_frames_video: int = Form(3),
    projects: ProjectStore = Depends(get_project_store),
    uploads: UploadStore = Depends(get_upload_store),
    annotations: AnnotationStore = Depends(get_annotation_store),
    store: EvalStore = Depends(get_eval_store),
):
    project = projects.get(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy project.")
    try:
        params = EvalParams(
            iou_threshold=iou_threshold,
            score_threshold=score_threshold,
            frame_step=frame_step,
            min_frames_video=min_frames_video,
        )
    except ValidationError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Tham số không hợp lệ: {error.errors()[0]['msg']}.") from error

    prediction = _read_prediction(file)
    project_uploads = [u for u in uploads.list() if u.project_id == project.id]
    if not project_uploads:
        raise HTTPException(status.HTTP_409_CONFLICT, "Project chưa có video nào.")

    created = datetime.now(timezone.utc)
    default_name = f"{prediction.model or 'Model'} · {created.strftime('%d/%m/%Y %H:%M')} UTC"
    try:
        run = run_evaluation(
            run_id=uuid.uuid4().hex,
            name=(name or "").strip() or default_name,
            project_id=project.id,
            project_name=project.name,
            uploads=project_uploads,
            get_annotation=annotations.get,
            prediction=prediction,
            params=params,
        )
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from error
    if run.video_count == 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Không có video nào đủ điều kiện để chấm: "
            + "; ".join(f"{s.name}: {s.reason}" for s in run.skipped[:5]),
        )
    store.save(run)
    return run


@router.get("", response_model=list[EvalRunInfo])
def list_evaluations(project_id: str | None = None, store: EvalStore = Depends(get_eval_store)):
    runs = store.list()
    return [r for r in runs if project_id is None or r.project_id == project_id]


@router.get("/{run_id}", response_model=EvalRun)
def get_evaluation(run_id: str, store: EvalStore = Depends(get_eval_store)):
    return _run_or_404(run_id, store)


@router.get("/{run_id}/download")
def download_evaluation(run_id: str, store: EvalStore = Depends(get_eval_store)):
    _run_or_404(run_id, store)
    return FileResponse(store.path(run_id), media_type="application/json", filename=f"evaluation_{run_id}.json")


@router.patch("/{run_id}/videos/{upload_id}", response_model=EvalRun)
def review_video(run_id: str, upload_id: str, data: VideoReviewIn, store: EvalStore = Depends(get_eval_store)):
    run = _run_or_404(run_id, store)
    if not any(v.upload_id == upload_id for v in run.videos):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video không có trong lượt đánh giá này.")
    note = (data.note or "").strip() or None

    def change(run: EvalRun) -> EvalRun:
        for video in run.videos:
            if video.upload_id == upload_id:
                video.review, video.note = data.review, note
        return run

    return store.update(run_id, change)


@router.patch("/{run_id}/report", response_model=EvalRun)
def update_report(run_id: str, data: ReportIn, store: EvalStore = Depends(get_eval_store)):
    _run_or_404(run_id, store)
    changes = data.model_dump(exclude_unset=True)

    def change(run: EvalRun) -> EvalRun:
        report = run.report
        if "summary_note" in changes:
            report.summary_note = (changes["summary_note"] or "").strip() or None
        if changes.get("status"):
            report.status = changes["status"]
            report.approved_at = datetime.now(timezone.utc) if report.status == "approved" else None
        return run

    return store.update(run_id, change)


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_evaluation(run_id: str, store: EvalStore = Depends(get_eval_store)):
    if not store.delete(run_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lượt đánh giá.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
