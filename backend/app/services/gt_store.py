"""Lưu các version GT đã khoá trong storage/gt/."""

import json
import re
import threading
from pathlib import Path

from app.schemas.gt import GtVersion, GtVersionInfo

VERSION_PATTERN = re.compile(r"^v(\d+)$")


class GtStore:
    """Lưu mỗi version GT thành một file JSON riêng: v1.json, v2.json...

    Version đã tạo thì không sửa được. index.json giữ thông tin tóm tắt để liệt kê
    nhanh mà không phải đọc các file GT lớn.
    """

    def __init__(self, gt_dir: Path):
        self.gt_dir = gt_dir
        self.gt_dir.mkdir(parents=True, exist_ok=True)
        self._index_path = gt_dir / "index.json"
        self._lock = threading.Lock()

    def path(self, version: str) -> Path | None:
        if not VERSION_PATTERN.match(version):
            return None
        path = self.gt_dir / f"{version}.json"
        return path if path.exists() else None

    def _read_index(self) -> list[GtVersionInfo]:
        if not self._index_path.exists():
            return []
        data = json.loads(self._index_path.read_text(encoding="utf-8"))
        return [GtVersionInfo.model_validate(item) for item in data]

    def list(self) -> list[GtVersionInfo]:
        """Version mới nhất trước. Sắp theo số version chứ không theo thời gian tạo, vì hai
        version tạo sát nhau có thể trùng thời gian (đồng hồ Windows chỉ chính xác khoảng 15 ms)."""
        with self._lock:
            return sorted(self._read_index(), key=lambda v: int(v.gt_version[1:]), reverse=True)

    def get(self, version: str) -> GtVersion | None:
        path = self.path(version)
        if path is None:
            return None
        return GtVersion.model_validate_json(path.read_text(encoding="utf-8"))

    def create(self, build) -> GtVersion:
        """Cấp số version kế tiếp rồi gọi build(version) để tạo nội dung, trong cùng một lock."""
        with self._lock:
            infos = self._read_index()
            numbers = [int(m.group(1)) for v in infos if (m := VERSION_PATTERN.match(v.gt_version))]
            gt: GtVersion = build(f"v{max(numbers, default=0) + 1}")

            path = self.gt_dir / f"{gt.gt_version}.json"
            tmp_path = path.with_suffix(".tmp")
            tmp_path.write_text(gt.model_dump_json(indent=1), encoding="utf-8")
            tmp_path.replace(path)

            infos.append(GtVersionInfo.model_validate(gt.model_dump(exclude={"videos"})))
            index_tmp = self._index_path.with_suffix(".tmp")
            index_tmp.write_text(
                json.dumps([i.model_dump(mode="json") for i in infos], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            index_tmp.replace(self._index_path)
            return gt
