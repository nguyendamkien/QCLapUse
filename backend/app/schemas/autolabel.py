"""Kiểu dữ liệu trạng thái một lần chạy auto label."""

from typing import Literal

from pydantic import BaseModel


class AutoLabelJob(BaseModel):
    # idle: chưa chạy lần nào kể từ khi máy chủ khởi động
    status: Literal["idle", "queued", "running", "done", "error"]
    progress: float = 0
    message: str | None = None
    error: str | None = None
    # Số người auto label tìm được, có khi status = done
    track_count: int | None = None
    # File model dùng cho lần chạy này, ví dụ yolo26s.pt hoặc yolo26x.pt
    model: str | None = None


class AutoLabelIn(BaseModel):
    # None: dùng model mặc định (AUTOLABEL_MODEL)
    model: str | None = None


class AutoLabelModel(BaseModel):
    id: str
    name: str
    note: str
    default: bool
