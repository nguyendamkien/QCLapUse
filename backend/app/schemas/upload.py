"""Kiểu dữ liệu của video đã tải lên và của thao tác phân loại.

Mỗi video là một bản ghi Upload trong storage/uploads/index.json, gồm metadata đọc
bằng ffprobe, trạng thái bản xem MP4 và kết quả phân loại.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# Video chỉ chia hai nhóm: có người sử dụng laptop và không có người sử dụng (xem doc/luong-qc.md).
# Dữ liệu cũ có trường subcase (case con), review_status, return_note (đã bỏ chức năng review)
# thì bị bỏ qua khi đọc.
VideoGroup = Literal["using", "not_using"]


class Upload(BaseModel):
    id: str
    name: str
    kind: Literal["video"] = "video"
    size: int
    duration: float | None
    fps: float | None = None
    width: int | None = None
    height: int | None = None
    codec: str | None = None
    status: Literal["ready"] = "ready"
    stored_as: str
    created_at: datetime

    # Bản xem H.264 cho video trình duyệt không phát được (ví dụ .avi MJPEG).
    # None nghĩa là phát thẳng file gốc.
    proxy_status: Literal["processing", "ready", "error"] | None = None
    proxy_error: str | None = None

    # Project (bộ video) chứa video này. None nghĩa là chưa thuộc project nào
    project_id: str | None = None

    # Phân loại. group = None nghĩa là video đang ở folder "Chưa phân loại"
    group: VideoGroup | None = None
    # Gợi ý từ tên thư mục lúc tải lên, chỉ để tham khảo khi phân loại
    suggested_group: VideoGroup | None = None
    classified_at: datetime | None = None


class ClassifyIn(BaseModel):
    """Phân loại một hoặc nhiều video cùng lúc. group = None để đưa về "Chưa phân loại"."""

    upload_ids: list[str] = Field(min_length=1)
    group: VideoGroup | None
