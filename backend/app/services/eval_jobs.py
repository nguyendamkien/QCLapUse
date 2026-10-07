"""Chạy đánh giá model trong nền và theo dõi tiến độ.

Trạng thái job chỉ giữ trong bộ nhớ: khởi động lại máy chủ thì mất, người dùng bấm chạy lại.
Kết quả đã chấm xong thì lưu thành lượt đánh giá (EvalStore) nên không mất.
Dùng chung khoá với auto label (detector.inference_lock): mỗi lúc chỉ một việc chạy model.
"""

import threading
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

from app.schemas.annotation import Annotation
from app.schemas.evaluation import EvalJob, EvalRunIn, PredictionFile
from app.schemas.upload import Upload
from app.services import model_runner
from app.services.autolabel import detector
from app.services.eval_store import EvalStore
from app.services.evaluator import run_evaluation
from app.services.gt_builder import check_video

_jobs: dict[str, EvalJob] = {}
_lock = threading.Lock()


def _set(job_id: str, **changes) -> None:
    with _lock:
        _jobs[job_id] = _jobs[job_id].model_copy(update=changes)


def get(job_id: str) -> EvalJob | None:
    with _lock:
        job = _jobs.get(job_id)
        return job.model_copy() if job else None


def list_jobs(project_id: str | None = None) -> list[EvalJob]:
    with _lock:
        jobs = [j.model_copy() for j in _jobs.values() if project_id is None or j.project_id == project_id]
    return sorted(jobs, key=lambda j: j.created_at, reverse=True)


def create(project_id: str, model_name: str) -> EvalJob:
    job = EvalJob(
        id=uuid.uuid4().hex,
        project_id=project_id,
        model_name=model_name,
        status="queued",
        message="Đang chờ việc chạy model khác xong...",
        created_at=datetime.now(timezone.utc),
    )
    with _lock:
        _jobs[job.id] = job
    return job.model_copy()


def eligible_uploads(uploads: list[Upload], get_annotation: Callable[[str], Annotation]) -> list[Upload]:
    """Video đủ điều kiện chấm; chỉ chạy model trên các video này cho đỡ tốn thời gian."""
    return [u for u in uploads if u.group and check_video(u, get_annotation(u.id)).eligible]


def run_job(
    job_id: str,
    *,
    request: EvalRunIn,
    model_name: str,
    model_path: Path,
    model_filename: str | None = None,
    project_name: str,
    uploads: list[Upload],
    upload_dir: Path,
    get_annotation: Callable[[str], Annotation],
    store: EvalStore,
) -> None:
    params = request.params
    try:
        with detector.inference_lock:
            _set(job_id, status="running", progress=0, message="Đang nạp model...")
            targets = eligible_uploads(uploads, get_annotation)
            missing_size = [u.name for u in targets if not (u.width and u.height)]
            if missing_size:
                raise RuntimeError("Chưa đọc được kích thước khung hình của: " + ", ".join(missing_size))

            predictor = model_runner.load_predictor(
                model_path, request.classes, params.score_threshold, model_filename
            )

            def on_progress(done: int, total: int, upload: Upload) -> None:
                _set(job_id, progress=min(done / total, 0.99), message=f"{upload.name}: đã chạy {done}/{total} frame")

            boxes = model_runner.predict_uploads(predictor, targets, upload_dir, params.frame_step, on_progress)

        _set(job_id, message="Đang so với GT...")
        run = run_evaluation(
            run_id=uuid.uuid4().hex,
            name=(request.name or "").strip() or f"{model_name} · {datetime.now(timezone.utc):%d/%m/%Y %H:%M} UTC",
            project_id=request.project_id,
            project_name=project_name,
            uploads=uploads,
            get_annotation=get_annotation,
            prediction=PredictionFile(model=model_name, videos=boxes),
            params=params,
        )
        run = run.model_copy(update={"source": "model", "classes": request.classes or None})
        store.save(run)
        _set(job_id, status="done", progress=1, message=None, run_id=run.id)
    except Exception as error:  # noqa: BLE001 - mọi lỗi đều phải hiện cho người dùng thấy
        _set(job_id, status="error", message=None, error=str(error))
