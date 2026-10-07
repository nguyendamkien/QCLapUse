"""Kiểu dữ liệu của project: một bộ video do người dùng tự gom lại ở trang Tải dữ liệu.

Project chỉ là nhãn gắn trên video (Upload.project_id), video vẫn lưu chung một chỗ.
"""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class Project(BaseModel):
    id: str
    name: str
    created_at: datetime


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Tên project không được để trống.")
        return value


class MoveToProjectIn(BaseModel):
    """Chuyển một hoặc nhiều video sang project khác. project_id = None để bỏ khỏi project."""

    upload_ids: list[str] = Field(min_length=1)
    project_id: str | None
