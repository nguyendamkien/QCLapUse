"""Kiểu dữ liệu của nhãn một video.

Cấu trúc:
    Annotation
    └── tracks: mỗi người đang sử dụng laptop là một track
        ├── segments:  các đoạn frame người đó xuất hiện, ví dụ [{start: 120, end: 480}]
        └── keyframes: box vẽ tay tại một số frame, ví dụ {120: box, 480: box}

Box ở các frame giữa hai keyframe được nội suy (services/track_interpolation.py),
nên người gán chỉ cần vẽ ở vài frame. Toạ độ box chuẩn hoá 0 đến 1 theo khung hình.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

# Danh sách case tạm thời, cần team chốt lại (xem doc/luong-qc.md)
VideoCase = Literal["sitting", "holding", "carrying", "not_using", "mixed"]


class BoxGeometry(BaseModel):
    # Toạ độ chuẩn hoá theo kích thước khung hình (0 đến 1)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)
    # Độ tin cậy của model, chỉ có ở box do auto label tạo. Người sửa box thì bỏ trường này
    confidence: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def check_inside_frame(self):
        if self.x + self.w > 1.0001 or self.y + self.h > 1.0001:
            raise ValueError("Box vượt ra ngoài khung hình.")
        return self


class Segment(BaseModel):
    """Một đoạn liên tục người xuất hiện, tính cả frame bắt đầu và kết thúc.

    end = None nghĩa là đoạn chưa được kết thúc, kéo dài tới hết video.
    """

    start: int = Field(ge=0)
    end: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def check_order(self):
        if self.end is not None and self.end < self.start:
            raise ValueError("Frame kết thúc phải sau frame bắt đầu.")
        return self

    def contains(self, frame: int) -> bool:
        return self.start <= frame and (self.end is None or frame <= self.end)


class Track(BaseModel):
    """Một người đang sử dụng laptop, xuất hiện trong một hoặc nhiều đoạn.

    Đoạn có thể chưa có box (mới đánh dấu thời gian xuất hiện), box vẽ sau.
    Box ở các frame giữa hai keyframe được nội suy tuyến tính.
    """

    track_id: int = Field(ge=1)
    segments: list[Segment] = Field(min_length=1)
    # Khoá là số thứ tự frame (bắt đầu từ 0)
    keyframes: dict[int, BoxGeometry] = {}
    # Nguồn gốc track, không bao giờ đổi: người vẽ (human) hay auto label tạo (auto)
    origin: Literal["human", "auto"] = "human"
    # Track auto mới tạo là False, thành True khi người gán chấp nhận hoặc chỉnh sửa.
    # Còn track chưa xác nhận thì không khoá GT được.
    confirmed: bool = True

    @model_validator(mode="after")
    def check_segments_and_keyframes(self):
        self.segments.sort(key=lambda s: s.start)
        for previous, current in zip(self.segments, self.segments[1:]):
            if previous.end is None or previous.end >= current.start:
                raise ValueError(f"Các đoạn của người #{self.track_id} bị chồng lên nhau.")
        for frame in self.keyframes:
            if not any(segment.contains(frame) for segment in self.segments):
                raise ValueError(f"Keyframe {frame} của người #{self.track_id} nằm ngoài các đoạn xuất hiện.")
        return self


class AnnotationIn(BaseModel):
    tracks: list[Track] = []
    case: VideoCase | None = None
    # Người gán đánh dấu đã gán xong mọi người trong video
    done: bool = False

    @model_validator(mode="after")
    def check_unique_track_ids(self):
        ids = [track.track_id for track in self.tracks]
        if len(ids) != len(set(ids)):
            raise ValueError("Mỗi người phải có số thứ tự (track_id) riêng.")
        return self


class AutoLabelRun(BaseModel):
    """Thông tin lần chạy auto label gần nhất, để biết track auto do model nào tạo."""

    model: str
    finished_at: datetime
    sample_step: int
    device_labels: list[str]


class Annotation(AnnotationIn):
    upload_id: str
    updated_at: datetime | None = None
    # Không nhận từ frontend; API lưu nhãn giữ nguyên giá trị đang có trong file
    auto_label: AutoLabelRun | None = None


class AnnotationSummary(BaseModel):
    track_count: int
    case: VideoCase | None
    done: bool
    # Số track auto chưa được người gán xác nhận
    auto_pending: int = 0
    updated_at: datetime | None


class FrameBox(BoxGeometry):
    track_id: int
    is_keyframe: bool
