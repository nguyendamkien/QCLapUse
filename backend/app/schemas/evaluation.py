"""Kiểu dữ liệu của bước đánh giá model (bước 5) và báo cáo (bước 6), xem doc/luong-qc.md.

Một lượt đánh giá (EvalRun) so kết quả dự đoán của model với GT dựng từ nhãn hiện tại của
một project. Kết quả dự đoán có từ việc chạy model đã tải lên (EvalModel) qua video của project,
hoặc từ file JSON do team model tự xuất. Chấm ở hai mức:
    mức box    tại các frame được chấm, ghép box dự đoán với box GT theo IoU
    mức video  model có nhận đúng video có / không có người sử dụng không
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, computed_field

from app.schemas.upload import VideoGroup


class EvalParams(BaseModel):
    # Box dự đoán và box GT chồng nhau ít nhất chừng này thì tính là khớp (true positive)
    iou_threshold: float = Field(default=0.5, gt=0, le=1)
    # Bỏ box dự đoán có độ tin cậy thấp hơn ngưỡng này
    score_threshold: float = Field(default=0.5, ge=0, le=1)
    # Chấm mỗi frame_step frame một lần, giống GT
    frame_step: int = Field(default=5, ge=1, le=1000)
    # Video được coi là model báo "có người sử dụng" khi có ít nhất chừng này frame được chấm có box
    min_frames_video: int = Field(default=3, ge=1)


class EvalModel(BaseModel):
    """File trọng số model (Ultralytics .pt / .onnx) tải lên để đánh giá."""

    id: str
    name: str
    filename: str
    stored_as: str
    size: int
    created_at: datetime
    # Các lớp model phát hiện được, đọc từ file lúc tải lên
    classes: dict[int, str]


class EvalRunIn(BaseModel):
    """Chạy model đã tải lên qua video của một project rồi chấm."""

    project_id: str
    model_id: str
    name: str | None = None
    # Lớp được tính là "người đang sử dụng laptop"; None hoặc rỗng là mọi lớp của model
    classes: list[str] | None = None
    params: EvalParams = EvalParams()


class EvalJob(BaseModel):
    """Một lần chạy model trong nền. Chỉ giữ trong bộ nhớ, khởi động lại máy chủ thì mất."""

    id: str
    project_id: str
    model_name: str
    status: Literal["queued", "running", "done", "error"]
    progress: float = 0
    message: str | None = None
    error: str | None = None
    # Có khi status = done
    run_id: str | None = None
    created_at: datetime


class PredBox(BaseModel):
    # [x, y, w, h] chuẩn hoá theo kích thước khung hình (0 đến 1), giống GT
    bbox: tuple[float, float, float, float]
    score: float = Field(default=1.0, ge=0, le=1)


class PredictionFile(BaseModel):
    """File dự đoán do team model tải lên.

    videos: khoá là id video (upload_id) hoặc tên file video; giá trị là box theo số frame.
    normalized = False nghĩa là bbox tính theo pixel, hệ thống tự chia cho kích thước khung hình.
    """

    model: str | None = None
    normalized: bool = True
    videos: dict[str, dict[int, list[PredBox]]]


class Metrics(BaseModel):
    tp: int = 0
    fp: int = 0
    fn: int = 0

    @computed_field
    @property
    def precision(self) -> float | None:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else None

    @computed_field
    @property
    def recall(self) -> float | None:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else None

    @computed_field
    @property
    def f1(self) -> float | None:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p and r else None


class VideoConfusion(BaseModel):
    """Mức video: positive là "có người sử dụng"."""

    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0

    @computed_field
    @property
    def accuracy(self) -> float | None:
        total = self.tp + self.fp + self.fn + self.tn
        return (self.tp + self.tn) / total if total else None


ErrorReview = Literal["unreviewed", "label_error", "model_error", "not_error"]


class VideoResult(BaseModel):
    upload_id: str
    name: str
    group: VideoGroup
    # Model báo có người sử dụng ở mức video không
    predicted_using: bool
    frames_evaluated: int
    frames_with_prediction: int
    box: Metrics
    # Các frame có lỗi (box thừa hoặc thiếu), để mở nhanh ở trang Gán nhãn. Giữ tối đa 50 frame
    error_frames: list[int] = []
    # Có trong file dự đoán không; không có thì coi như model không phát hiện gì
    in_prediction_file: bool = True
    # QC lead phân loại lỗi: do nhãn hay do model
    review: ErrorReview = "unreviewed"
    note: str | None = None

    @computed_field
    @property
    def has_error(self) -> bool:
        video_wrong = self.predicted_using != (self.group == "using")
        return video_wrong or self.box.fp > 0 or self.box.fn > 0


class SkippedVideo(BaseModel):
    upload_id: str
    name: str
    reason: str


class EvalReport(BaseModel):
    """Phần báo cáo (bước 6): nhận xét, đề xuất và trạng thái duyệt của QC lead."""

    status: Literal["draft", "approved"] = "draft"
    summary_note: str | None = None
    approved_at: datetime | None = None


class EvalRunInfo(BaseModel):
    id: str
    name: str
    project_id: str
    project_name: str
    model: str | None
    # model: chạy model đã tải lên; prediction_file: dùng file JSON kết quả có sẵn
    source: Literal["model", "prediction_file"] = "prediction_file"
    # Lớp của model được tính là người sử dụng laptop (chỉ có khi source = model)
    classes: list[str] | None = None
    created_at: datetime
    params: EvalParams
    box: Metrics
    box_by_group: dict[str, Metrics]
    video: VideoConfusion
    video_count: int
    error_video_count: int
    report: EvalReport


class EvalRun(EvalRunInfo):
    videos: list[VideoResult]
    skipped: list[SkippedVideo]
    # Khoá trong file dự đoán không khớp video nào của project
    unmatched_prediction_keys: list[str] = []


class VideoReviewIn(BaseModel):
    review: ErrorReview
    note: str | None = None


class ReportIn(BaseModel):
    summary_note: str | None = None
    status: Literal["draft", "approved"] | None = None
