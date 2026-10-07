"""Chạy auto label cho một video trong nền và theo dõi tiến độ.

Trạng thái job chỉ giữ trong bộ nhớ: khởi động lại máy chủ thì mất, người gán bấm chạy lại.
Mỗi lúc chỉ chạy một video vì model dùng hết CPU; video bấm sau sẽ ở trạng thái queued.
"""

import math
import threading
from datetime import datetime, timezone

from app.schemas.annotation import Annotation, AutoLabelRun, Track
from app.schemas.autolabel import AutoLabelJob
from app.services.annotation_store import AnnotationStore
from app.services.autolabel import detector as detector_module
from app.services.autolabel.pipeline import Params, Sample, build_tracks
from app.services.upload_store import UploadStore

_jobs: dict[str, AutoLabelJob] = {}
_jobs_lock = threading.Lock()


def has_human_work(annotation: Annotation) -> bool:
    """Có track người vẽ, hoặc track auto đã được xác nhận: không được ghi đè."""
    return any(t.origin == "human" or t.confirmed for t in annotation.tracks)


def get_job(upload_id: str) -> AutoLabelJob:
    with _jobs_lock:
        job = _jobs.get(upload_id)
        return job.model_copy() if job else AutoLabelJob(status="idle")


def _set(upload_id: str, **changes) -> None:
    with _jobs_lock:
        current = _jobs.get(upload_id, AutoLabelJob(status="queued"))
        _jobs[upload_id] = current.model_copy(update=changes)


def queue_job(upload_id: str, model_file: str | None = None) -> AutoLabelJob | None:
    """Đưa video vào hàng đợi. Trả None nếu video đang chờ hoặc đang chạy rồi."""
    with _jobs_lock:
        job = _jobs.get(upload_id)
        if job and job.status in ("queued", "running"):
            return None
        _jobs[upload_id] = AutoLabelJob(
            status="queued", message="Đang chờ video khác chạy xong...", model=model_file or detector_module.default_model()
        )
        return _jobs[upload_id].model_copy()


def run_job(
    upload_id: str,
    uploads: UploadStore,
    annotations: AnnotationStore,
    samples_per_second: float,
    params: Params | None = None,
    model_file: str | None = None,
) -> None:
    params = params or Params()
    try:
        with detector_module.inference_lock:
            _set(upload_id, status="running", progress=0, message="Đang nạp model (lần đầu sẽ tải trọng số)...")
            upload = uploads.get(upload_id)
            if upload is None:
                raise RuntimeError("Video đã bị xoá.")

            # ByteTrack cần cả box người điểm thấp (lượt ghép thứ hai)
            person_min = params.bytetrack_low_score if params.tracker == "bytetrack" else params.person_score
            detector = detector_module.get_detector(
                {"person", *params.device_labels}, min(person_min, params.device_score), model_file
            )
            # Ví dụ video 25 fps, 10 mẫu mỗi giây: bước 25 / 10 = 2,5 làm tròn thành 2, đưa frame 0, 2, 4... vào detector.
            # Video 10 fps thì lấy mọi frame
            step = max(1, round(upload.fps / samples_per_second))
            total = max(1, math.ceil(math.floor(upload.duration * upload.fps) / step))

            samples = []
            frames = detector_module.iter_frames(uploads.upload_dir / upload.stored_as, upload.width, upload.height, step)
            for frame, rgb in frames:
                samples.append(Sample(frame=frame, detections=detector.detect(rgb)))
                done = len(samples)
                _set(upload_id, progress=min(done / total, 0.99), message=f"Đã xem {done}/{total} frame")

            tracks = build_tracks(samples, upload.width, upload.height, upload.fps, params)

            # Đọc lại nhãn: trong lúc chạy người gán có thể đã tự vẽ, khi đó không ghi đè
            latest = annotations.get(upload_id)
            if has_human_work(latest):
                raise RuntimeError("Trong lúc chạy, video đã có nhãn do người gán nên không ghi kết quả auto label.")
            now = datetime.now(timezone.utc)
            annotations.save(
                latest.model_copy(
                    update={
                        "tracks": [Track.model_validate(t) for t in tracks],
                        "done": False,
                        "updated_at": now,
                        "auto_label": AutoLabelRun(
                            model=detector_module.model_name(model_file),
                            finished_at=now,
                            sample_step=step,
                            device_labels=list(params.device_labels),
                        ),
                    }
                )
            )
            _set(upload_id, status="done", progress=1, message=None, track_count=len(tracks))
    except Exception as error:  # noqa: BLE001 - mọi lỗi đều phải hiện cho người gán thấy
        _set(upload_id, status="error", message=None, error=str(error))
