"""Lưu các file trọng số model tải lên để đánh giá, trong storage/eval_models/.

Mỗi model một file <id>.pt (hoặc .onnx) kèm bản ghi trong index.json.
"""

import json
import threading
from pathlib import Path

from app.schemas.evaluation import EvalModel


class EvalModelStore:
    def __init__(self, model_dir: Path):
        self.model_dir = model_dir
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self._index_path = model_dir / "index.json"
        self._lock = threading.Lock()

    def _read(self) -> list[EvalModel]:
        if not self._index_path.exists():
            return []
        return [EvalModel.model_validate(m) for m in json.loads(self._index_path.read_text(encoding="utf-8"))]

    def _write(self, models: list[EvalModel]) -> None:
        tmp_path = self._index_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps([m.model_dump(mode="json") for m in models], ensure_ascii=False, indent=2), encoding="utf-8"
        )
        tmp_path.replace(self._index_path)

    def list(self) -> list[EvalModel]:
        with self._lock:
            return sorted(self._read(), key=lambda m: m.created_at, reverse=True)

    def get(self, model_id: str) -> EvalModel | None:
        with self._lock:
            return next((m for m in self._read() if m.id == model_id), None)

    def path(self, model: EvalModel) -> Path:
        return self.model_dir / model.stored_as

    def add(self, model: EvalModel) -> None:
        with self._lock:
            self._write([*self._read(), model])

    def delete(self, model_id: str) -> EvalModel | None:
        with self._lock:
            models = self._read()
            target = next((m for m in models if m.id == model_id), None)
            if target is None:
                return None
            self._write([m for m in models if m.id != model_id])
        self.path(target).unlink(missing_ok=True)
        return target
