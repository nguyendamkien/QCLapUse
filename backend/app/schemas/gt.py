"""Kiểu dữ liệu của ground truth (GT).

Một version GT (GtVersion) gồm thông tin chung, thống kê và danh sách GtVideo. Mỗi GtVideo có:
    frames  box tại các frame được chấm (frame chia hết cho frame_step)
    events  các đoạn thời gian một người sử dụng laptop
    ignore  các khoảng có người nhưng chưa biết vị trí box, không chấm điểm
Frame được chấm mà không có box và không nằm trong ignore là negative.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, computed_field

from app.schemas.upload import VideoGroup


class GtIssue(BaseModel):
    # error: chặn không cho đưa video vào GT; warning: vẫn đưa vào được
    level: Literal["error", "warning"]
    message: str


class GtVideoCheck(BaseModel):
    upload_id: str
    name: str
    group: VideoGroup
    total_frames: int | None
    track_count: int
    issues: list[GtIssue]

    @computed_field
    @property
    def eligible(self) -> bool:
        return not any(issue.level == "error" for issue in self.issues)


class GtReadiness(BaseModel):
    videos: list[GtVideoCheck]
    unclassified_count: int


class GtCreate(BaseModel):
    upload_ids: list[str] = Field(min_length=1)
    # Chỉ chấm mỗi frame_step frame một lần, vì các frame liền nhau gần như trùng nhau
    frame_step: int = Field(default=5, ge=1, le=1000)
    note: str | None = None


class GtBox(BaseModel):
    track_id: int
    # [x, y, w, h] chuẩn hoá theo kích thước khung hình (0 đến 1)
    bbox: tuple[float, float, float, float]
    source: Literal["keyframe", "interpolated"]


class GtEvent(BaseModel):
    """Một đoạn liên tục một người sử dụng laptop, tính cả hai đầu."""

    track_id: int
    start: int
    end: int


class GtIgnore(BaseModel):
    """Khoảng frame không chấm điểm cho một người: có người nhưng chưa biết vị trí box."""

    track_id: int
    start: int
    end: int
    reason: str


class GtVideo(BaseModel):
    upload_id: str
    name: str
    fps: float
    width: int | None
    height: int | None
    total_frames: int
    group: VideoGroup
    source_annotation_updated_at: datetime | None
    events: list[GtEvent]
    # Chỉ gồm frame được chấm (chia hết cho frame_step) và có box.
    # Frame được chấm không có box và không thuộc ignore là negative.
    frames: dict[int, list[GtBox]]
    ignore: list[GtIgnore]


class GtStats(BaseModel):
    video_count: int
    eval_frame_count: int
    box_count: int
    by_group: dict[str, int]


class GtVersionInfo(BaseModel):
    gt_version: str
    created_at: datetime
    frame_step: int
    note: str | None
    stats: GtStats


class GtVersion(GtVersionInfo):
    videos: list[GtVideo]


class GtPreview(BaseModel):
    """GT của một video dựng từ nhãn hiện tại, chưa khoá vào version nào."""

    frame_step: int
    eligible: bool
    issues: list[GtIssue]
    video: GtVideo
