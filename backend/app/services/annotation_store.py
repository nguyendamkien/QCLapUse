"""Lưu nhãn của từng video, mỗi video một file JSON trong storage/annotations/."""

import json
from pathlib import Path

from app.schemas.annotation import Annotation, AnnotationSummary


def _frames_to_tracks(frames: dict) -> list[dict]:
    """Chuyển nhãn định dạng cũ (box theo từng frame mẫu) sang track.

    Bỏ box laptop và box người "không dùng" vì nay chỉ gán người đang sử dụng
    laptop. Mỗi người thành một track có một đoạn, từ frame gán đầu tiên tới frame
    gán cuối cùng, các frame đã gán trở thành keyframe.
    """
    tracks: dict[int, dict] = {}
    for frame, boxes in frames.items():
        for box in boxes:
            if box.get("label", "person") != "person" or box.get("interaction") == "not_using":
                continue
            track = tracks.setdefault(box["track_id"], {"track_id": box["track_id"], "keyframes": {}})
            track["keyframes"][int(frame)] = {key: box[key] for key in ("x", "y", "w", "h")}

    for track in tracks.values():
        frame_numbers = sorted(track["keyframes"])
        track["segments"] = [{"start": frame_numbers[0], "end": frame_numbers[-1]}]
    return sorted(tracks.values(), key=lambda t: t["track_id"])


class AnnotationStore:
    """Lưu nhãn của mỗi video thành một file JSON riêng: <upload_id>.json."""

    def __init__(self, annotation_dir: Path):
        self.annotation_dir = annotation_dir
        self.annotation_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, upload_id: str) -> Path:
        return self.annotation_dir / f"{upload_id}.json"

    def _load(self, path: Path) -> Annotation:
        data = json.loads(path.read_text(encoding="utf-8"))
        # File nhãn định dạng cũ (box theo từng frame) thì chuyển sang track khi đọc
        if "tracks" not in data:
            data["tracks"] = _frames_to_tracks(data.pop("frames", {}))
        return Annotation.model_validate(data)

    def get(self, upload_id: str) -> Annotation:
        path = self._path(upload_id)
        if not path.exists():
            return Annotation(upload_id=upload_id)
        return self._load(path)

    def save(self, annotation: Annotation) -> None:
        path = self._path(annotation.upload_id)
        # Ghi file tạm rồi đổi tên để không bao giờ để lại file nhãn ghi dở
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(annotation.model_dump_json(indent=2), encoding="utf-8")
        tmp_path.replace(path)

    def delete(self, upload_id: str) -> None:
        self._path(upload_id).unlink(missing_ok=True)

    def summaries(self) -> dict[str, AnnotationSummary]:
        result = {}
        for path in self.annotation_dir.glob("*.json"):
            annotation = self._load(path)
            result[annotation.upload_id] = AnnotationSummary(
                track_count=len(annotation.tracks),
                case=annotation.case,
                done=annotation.done,
                auto_pending=sum(1 for t in annotation.tracks if not t.confirmed),
                updated_at=annotation.updated_at,
            )
        return result
