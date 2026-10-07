"""Lưu thông tin các video đã tải lên, tạm thời bằng file JSON thay cho database."""

import json
import threading
from collections.abc import Iterable
from pathlib import Path

from app.schemas.upload import Upload


class UploadStore:
    """Lưu thông tin video đã tải lên vào file index.json nằm cạnh các video.

    Dùng tạm cho tới khi có database.
    """

    def __init__(self, upload_dir: Path):
        self.upload_dir = upload_dir
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self._index_path = upload_dir / "index.json"
        # Nhiều request chạy song song (threadpool của FastAPI) cùng đọc-sửa-ghi index.json
        self._lock = threading.Lock()

    def _read(self) -> list[Upload]:
        if not self._index_path.exists():
            return []
        data = json.loads(self._index_path.read_text(encoding="utf-8"))
        return [Upload.model_validate(item) for item in data]

    def _write(self, uploads: list[Upload]) -> None:
        # Ghi ra file tạm rồi đổi tên: nếu máy tắt giữa chừng thì index.json cũ vẫn nguyên vẹn
        tmp_path = self._index_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps([u.model_dump(mode="json") for u in uploads], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(self._index_path)

    def list(self) -> list[Upload]:
        with self._lock:
            return sorted(self._read(), key=lambda u: u.created_at, reverse=True)

    def get(self, upload_id: str) -> Upload | None:
        with self._lock:
            return next((u for u in self._read() if u.id == upload_id), None)

    def add(self, upload: Upload) -> None:
        with self._lock:
            uploads = self._read()
            uploads.append(upload)
            self._write(uploads)

    def update(self, upload: Upload) -> None:
        self.update_many([upload])

    def update_many(self, updated: Iterable[Upload]) -> None:
        """Thay các bản ghi có cùng id bằng bản mới, giữ nguyên thứ tự trong file."""
        by_id = {u.id: u for u in updated}
        with self._lock:
            self._write([by_id.get(u.id, u) for u in self._read()])

    def delete(self, upload_id: str) -> Upload | None:
        with self._lock:
            uploads = self._read()
            target = next((u for u in uploads if u.id == upload_id), None)
            if target is None:
                return None
            self._write([u for u in uploads if u.id != upload_id])
        (self.upload_dir / target.stored_as).unlink(missing_ok=True)
        return target
