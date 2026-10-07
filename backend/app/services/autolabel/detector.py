"""Đọc frame từ video và chạy model phát hiện người, laptop.

Model: mặc định YOLO26s của Ultralytics, huấn luyện trên bộ COCO (80 lớp). Chỉ lấy các lớp được yêu
cầu (mặc định person và laptop, xem Params.device_labels). Đổi model bằng AUTOLABEL_MODEL trong .env:
cùng họ YOLO (yolo26n.pt nhanh hơn, yolo26m.pt / yolo26x.pt chính xác hơn) hoặc RT-DETR (rtdetr-l.pt, rtdetr-x.pt,
cũng huấn luyện trên COCO). Chưa có file thì ultralytics tự tải về storage/models/.
Đổi hẳn sang thư viện khác thì chỉ cần sửa file này.

Lưu ý giấy phép: ultralytics dùng AGPL-3.0. Dùng cho sản phẩm thương mại hoặc dịch vụ không
công khai mã nguồn thì cần giấy phép Enterprise của Ultralytics.

ultralytics không nằm trong requirements.txt chính mà ở requirements-autolabel.txt, nên chỉ
import khi thật sự chạy; backend vẫn chạy bình thường khi chưa cài.
"""

import importlib.util
import shutil
import subprocess
import threading
from collections.abc import Iterator
from pathlib import Path

from app.core.config import settings
from app.services.autolabel.pipeline import Detection


def load_ultralytics(path: Path, filename: str | None = None):
    """Nạp model Ultralytics đúng loại theo tên file: có "rtdetr" / "rt-detr" thì là RT-DETR, còn lại là YOLO.

    Không nhận ra loại từ chính file được (RT-DETR và YOLO đều là DetectionModel), nên dựa vào tên.
    Nạp RT-DETR bằng lớp YOLO thì bước hậu xử lý sai (RT-DETR không dùng NMS) và box ra lung tung.
    """
    from ultralytics import RTDETR, YOLO

    name = (filename or path.name).lower()
    model_class = RTDETR if "rtdetr" in name or "rt-detr" in name else YOLO
    return model_class(str(path))


# Các model chọn được ở nút Auto label (đều huấn luyện trên COCO nên có lớp person, laptop).
# Đo trên CPU, video 52 giây 25 fps lấy mẫu mỗi 2 frame (xem doc/auto-label.md)
MODEL_CHOICES = {
    "yolo26s.pt": {"name": "YOLO26s", "note": "Nhanh (khoảng 0,2 giây mỗi frame trên CPU). Mặc định."},
    "yolo26x.pt": {
        "name": "YOLO26x",
        "note": "Bản lớn nhất của YOLO26: thấy laptop ở nhiều frame hơn nhưng chậm hơn khoảng 5 lần (1,2 giây mỗi frame).",
    },
}


def default_model() -> str:
    return settings.AUTOLABEL_MODEL


def list_models() -> list[dict]:
    """Model chọn được, model mặc định (AUTOLABEL_MODEL) đứng đầu kể cả khi không có trong MODEL_CHOICES."""
    choices = dict(MODEL_CHOICES)
    choices.setdefault(default_model(), {"name": default_model(), "note": "Model đặt trong AUTOLABEL_MODEL."})
    ordered = [default_model(), *[m for m in choices if m != default_model()]]
    return [{"id": m, **choices[m], "default": m == default_model()} for m in ordered]


def model_name(model_file: str | None = None) -> str:
    return f"Ultralytics {model_file or default_model()} (COCO)"


def is_available() -> bool:
    return all(importlib.util.find_spec(name) for name in ("ultralytics", "numpy"))


class Detector:
    def __init__(self, labels: set[str], min_score: float, model_file: str | None = None):
        settings.MODEL_DIR.mkdir(parents=True, exist_ok=True)
        # Chưa có file thì ultralytics tự tải trọng số về đúng đường dẫn này
        # (yolo26s khoảng 20 MB, yolo26x khoảng 119 MB)
        self.model = load_ultralytics(settings.MODEL_DIR / (model_file or default_model()))
        self.names = self.model.names
        self.labels = labels
        self.min_score = min_score

    def detect(self, rgb) -> list[Detection]:
        """rgb: mảng numpy (cao, rộng, 3) kiểu uint8."""
        import numpy as np

        # ultralytics coi mảng numpy là ảnh BGR (theo OpenCV) nên phải đảo kênh màu
        bgr = np.ascontiguousarray(rgb[:, :, ::-1])
        # Chỉ cho model trả các lớp cần dùng, không phát hiện đủ 80 lớp của COCO rồi mới lọc
        classes = [i for i, name in self.names.items() if name in self.labels]
        boxes = self.model.predict(bgr, conf=self.min_score, classes=classes, verbose=False)[0].boxes
        detections = []
        for xyxy, cls, conf in zip(boxes.xyxy.tolist(), boxes.cls.tolist(), boxes.conf.tolist()):
            label = self.names[int(cls)]
            if label not in self.labels:
                continue
            feature = appearance_feature(rgb, xyxy) if label == "person" else None
            detections.append(Detection(label=label, score=float(conf), box=tuple(xyxy), feature=feature))
        return detections


# Hai vùng lấy màu, theo tỷ lệ chiều cao box người: áo (thân trên) và quần (thân dưới)
BODY_PARTS = ((0.15, 0.5), (0.5, 0.85))


def appearance_feature(rgb, box) -> tuple[float, ...] | None:
    """Đặc trưng ngoại hình của một người: histogram màu HSV của áo và quần, tổng bằng 1.

    Dùng HSV (sắc độ, độ bão hoà, độ sáng) thay vì RGB để bớt phụ thuộc ánh sáng; tách áo và
    quần để phân biệt người áo sáng quần tối với người áo tối quần sáng. Bỏ hai mép box để
    bớt lẫn nền. Đo trên video mẫu: cùng một người ở hai frame liền nhau thì 95% trên 0,95,
    hai người khác nhau thì cao nhất 0,85.
    """
    import cv2
    import numpy as np

    height, width = rgb.shape[:2]
    x1, y1, x2, y2 = box
    box_w, box_h = x2 - x1, y2 - y1
    left, right = int(max(0, x1 + 0.2 * box_w)), int(min(width, x2 - 0.2 * box_w))
    parts = []
    for top, bottom in BODY_PARTS:
        crop = rgb[int(max(0, y1 + top * box_h)) : int(min(height, y1 + bottom * box_h)), left:right]
        if crop.size == 0:
            return None
        hsv = cv2.cvtColor(np.ascontiguousarray(crop), cv2.COLOR_RGB2HSV)
        hue_sat = cv2.calcHist([hsv], [0, 1], None, [16, 8], [0, 180, 0, 256]).ravel()
        value = cv2.calcHist([hsv], [2], None, [8], [0, 256]).ravel()
        parts += [hue_sat / max(hue_sat.sum(), 1), value / max(value.sum(), 1)]
    # Bốn histogram, mỗi cái tổng bằng 1, nên chia 4 để cả đặc trưng tổng bằng 1
    return tuple((np.concatenate(parts) / len(parts)).tolist())


# Mỗi model nạp một lần rồi giữ lại, đổi qua lại giữa các model không phải nạp lại
_detectors: dict[str, Detector] = {}
_detector_lock = threading.Lock()

# Chạy model dùng hết CPU: auto label và đánh giá model chạy lần lượt, không song song
inference_lock = threading.Lock()


def get_detector(labels: set[str], min_score: float, model_file: str | None = None) -> Detector:
    """Nạp model một lần rồi dùng lại cho các lần chạy sau (nạp mất vài giây)."""
    model_file = model_file or default_model()
    with _detector_lock:
        detector = _detectors.get(model_file)
        if detector is None:
            detector = _detectors[model_file] = Detector(labels, min_score, model_file)
        detector.labels = labels
        detector.min_score = min_score
        return detector


def iter_frames(path: Path, width: int, height: int, step: int) -> Iterator[tuple[int, object]]:
    """Lần lượt trả (số thứ tự frame, ảnh RGB) của các frame 0, step, 2*step...

    Dùng ffmpeg chọn frame theo đúng số thứ tự trong file gốc, nên khớp với số frame của nhãn.
    """
    import numpy as np

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("Máy chủ chưa cài ffmpeg nên không đọc được frame video.")

    process = subprocess.Popen(
        [
            ffmpeg, "-v", "error", "-i", str(path),
            "-map", "0:v:0",
            "-vf", f"select=not(mod(n\\,{step}))",
            "-fps_mode", "passthrough",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    frame_size = width * height * 3
    index = 0
    try:
        while chunk := process.stdout.read(frame_size):
            if len(chunk) < frame_size:
                break
            yield index * step, np.frombuffer(chunk, np.uint8).reshape(height, width, 3)
            index += 1
    finally:
        process.kill()
        process.wait()
