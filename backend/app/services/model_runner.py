"""Chạy model đã tải lên qua video của một project để lấy kết quả dự đoán (bước 5).

Model là file trọng số Ultralytics (.pt hoặc .onnx): YOLO hoặc RT-DETR (tên file có "rtdetr"),
ví dụ model huấn luyện riêng để phát hiện người đang sử dụng laptop. Chỉ đọc các frame được chấm
(0, frame_step, 2 * frame_step...) bằng ffmpeg, theo đúng số thứ tự frame của file gốc nên khớp với nhãn.

ultralytics nằm trong requirements-autolabel.txt, chỉ import khi thật sự chạy.
"""

from collections.abc import Callable
from pathlib import Path

from app.schemas.evaluation import PredBox
from app.schemas.upload import Upload
from app.services.autolabel import detector
from app.services.gt_builder import total_frames

Predictor = Callable[[object], list[PredBox]]


def read_classes(path: Path, filename: str | None = None) -> dict[int, str]:
    """Nạp model để đọc tên các lớp. Không nạp được thì báo lỗi (file hỏng, sai định dạng)."""
    try:
        names = detector.load_ultralytics(path, filename).names
    except Exception as error:  # noqa: BLE001 - ultralytics ném nhiều loại lỗi khác nhau
        raise ValueError(f"Không đọc được file model: {error}") from error
    return {int(i): str(name) for i, name in names.items()}


def load_predictor(
    path: Path, class_names: list[str] | None, score_threshold: float, filename: str | None = None
) -> Predictor:
    """Nạp model một lần, trả hàm nhận ảnh RGB và trả box đã chuẩn hoá 0 đến 1.

    filename: tên file gốc lúc tải lên, để biết là RT-DETR hay YOLO (file lưu trên đĩa đặt tên theo id).
    """
    import numpy as np

    model = detector.load_ultralytics(path, filename)
    classes = [i for i, name in model.names.items() if name in class_names] if class_names else None
    if class_names and not classes:
        raise ValueError(f"Model không có lớp nào trong: {', '.join(class_names)}.")

    def predict(rgb) -> list[PredBox]:
        # ultralytics coi mảng numpy là ảnh BGR nên phải đảo kênh màu
        bgr = np.ascontiguousarray(rgb[:, :, ::-1])
        boxes = model.predict(bgr, conf=score_threshold, classes=classes, verbose=False)[0].boxes
        return [
            PredBox(bbox=(x1, y1, x2 - x1, y2 - y1), score=float(conf))
            for (x1, y1, x2, y2), conf in zip(boxes.xyxyn.tolist(), boxes.conf.tolist())
        ]

    return predict


def frames_to_check(upload: Upload, frame_step: int) -> int:
    count = total_frames(upload) or 0
    return -(-count // frame_step)  # làm tròn lên


def predict_uploads(
    predictor: Predictor,
    uploads: list[Upload],
    upload_dir: Path,
    frame_step: int,
    on_progress: Callable[[int, int, Upload], None],
) -> dict[str, dict[int, list[PredBox]]]:
    """Chạy predictor trên các frame được chấm của từng video. Trả box theo id video, rồi theo frame."""
    total = max(1, sum(frames_to_check(u, frame_step) for u in uploads))
    done = 0
    result: dict[str, dict[int, list[PredBox]]] = {}
    for upload in uploads:
        boxes: dict[int, list[PredBox]] = {}
        frames = detector.iter_frames(upload_dir / upload.stored_as, upload.width, upload.height, frame_step)
        for frame, rgb in frames:
            found = predictor(rgb)
            if found:
                boxes[frame] = found
            done += 1
            on_progress(done, total, upload)
        result[upload.id] = boxes
    return result
