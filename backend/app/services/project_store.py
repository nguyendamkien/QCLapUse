"""Lưu danh sách project trong một file JSON, tạm thời thay cho database."""

import json
import threading
from pathlib import Path

from app.schemas.project import Project


class ProjectStore:
    """Lưu các project vào projects.json. Video nào thuộc project nào thì lưu ở Upload.project_id."""

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _read(self) -> list[Project]:
        if not self.path.exists():
            return []
        data = json.loads(self.path.read_text(encoding="utf-8"))
        return [Project.model_validate(item) for item in data]

    def _write(self, projects: list[Project]) -> None:
        # Ghi ra file tạm rồi đổi tên để không để lại file ghi dở
        tmp_path = self.path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps([p.model_dump(mode="json") for p in projects], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(self.path)

    def list(self) -> list[Project]:
        """Cũ nhất trước, để thứ tự các tab project không bị đảo khi tạo thêm."""
        with self._lock:
            return sorted(self._read(), key=lambda p: p.created_at)

    def get(self, project_id: str) -> Project | None:
        with self._lock:
            return next((p for p in self._read() if p.id == project_id), None)

    def find_by_name(self, name: str) -> Project | None:
        """Tìm theo tên, không phân biệt hoa thường."""
        key = name.casefold()
        with self._lock:
            return next((p for p in self._read() if p.name.casefold() == key), None)

    def add(self, project: Project) -> None:
        with self._lock:
            self._write([*self._read(), project])

    def update(self, project: Project) -> None:
        with self._lock:
            self._write([project if p.id == project.id else p for p in self._read()])

    def delete(self, project_id: str) -> Project | None:
        with self._lock:
            projects = self._read()
            target = next((p for p in projects if p.id == project_id), None)
            if target is not None:
                self._write([p for p in projects if p.id != project_id])
            return target
