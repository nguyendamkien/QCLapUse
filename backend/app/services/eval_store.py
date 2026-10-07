"""Lưu các lượt đánh giá model trong storage/evaluations/, mỗi lượt một file <id>.json."""

import re
import threading
from pathlib import Path

from app.schemas.evaluation import EvalRun, EvalRunInfo

RUN_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


class EvalStore:
    def __init__(self, eval_dir: Path):
        self.eval_dir = eval_dir
        self.eval_dir.mkdir(parents=True, exist_ok=True)
        # Sửa phân loại lỗi / báo cáo là đọc-sửa-ghi cả file, nên cần lock
        self._lock = threading.Lock()

    def path(self, run_id: str) -> Path | None:
        # Chỉ nhận id dạng hex để không đọc được file ngoài thư mục
        if not RUN_ID_PATTERN.match(run_id):
            return None
        path = self.eval_dir / f"{run_id}.json"
        return path if path.exists() else None

    def list(self) -> list[EvalRunInfo]:
        """Mới nhất trước. Đọc cả file vì số lượt đánh giá ít; phần videos bị bỏ qua khi trả về."""
        runs = [
            EvalRunInfo.model_validate_json(p.read_text(encoding="utf-8")) for p in self.eval_dir.glob("*.json")
        ]
        return sorted(runs, key=lambda r: r.created_at, reverse=True)

    def get(self, run_id: str) -> EvalRun | None:
        path = self.path(run_id)
        return EvalRun.model_validate_json(path.read_text(encoding="utf-8")) if path else None

    def save(self, run: EvalRun) -> None:
        with self._lock:
            self._write(run)

    def update(self, run_id: str, change) -> EvalRun | None:
        """Đọc lượt đánh giá, gọi change(run) để sửa, rồi ghi lại, trong cùng một lock."""
        with self._lock:
            run = self.get(run_id)
            if run is None:
                return None
            run = change(run)
            self._write(run)
            return run

    def delete(self, run_id: str) -> bool:
        path = self.path(run_id)
        if path is None:
            return False
        path.unlink(missing_ok=True)
        return True

    def _write(self, run: EvalRun) -> None:
        path = self.eval_dir / f"{run.id}.json"
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(run.model_dump_json(indent=1), encoding="utf-8")
        tmp_path.replace(path)
