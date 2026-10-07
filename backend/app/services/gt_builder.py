"""Kiểm tra điều kiện và dựng nội dung GT từ phân loại và nhãn của từng video.

check_video   liệt kê vấn đề của một video (error: không cho vào GT, warning: vẫn cho)
build_video   chuyển nhãn (track, đoạn, keyframe) thành dạng GT (frames, events, ignore)
build_version gom các video thành một version kèm thống kê
"""

import math
from collections import Counter
from datetime import datetime, timezone

from app.schemas.annotation import Annotation
from app.schemas.gt import (
    GtBox,
    GtEvent,
    GtIgnore,
    GtIssue,
    GtStats,
    GtVersion,
    GtVideo,
    GtVideoCheck,
)
from app.schemas.upload import Upload
from app.services.track_interpolation import expand_to_frames


def total_frames(upload: Upload) -> int | None:
    if not upload.fps or not upload.duration:
        return None
    return math.floor(upload.duration * upload.fps)


def _segment_end(segment, frame_count: int) -> int:
    """Frame cuối của đoạn, cắt theo độ dài video. Đoạn chưa kết thúc kéo tới hết video."""
    return frame_count - 1 if segment.end is None else min(segment.end, frame_count - 1)


def check_video(upload: Upload, annotation: Annotation) -> GtVideoCheck:
    """Kiểm tra một video đã phân loại có đủ điều kiện đưa vào GT không (xem doc/luong-qc.md)."""
    issues: list[GtIssue] = []

    def error(message: str):
        issues.append(GtIssue(level="error", message=message))

    def warning(message: str):
        issues.append(GtIssue(level="warning", message=message))

    if total_frames(upload) is None:
        error("Chưa đọc được fps hoặc thời lượng. Mở video ở trang Gán nhãn một lần để đọc bổ sung.")

    if upload.group == "using":
        if not annotation.tracks:
            error("Chưa gán người nào dù được phân loại là có người sử dụng.")
        open_tracks = [t.track_id for t in annotation.tracks if any(s.end is None for s in t.segments)]
        if open_tracks:
            error("Còn đoạn chưa kết thúc ở người " + ", ".join(f"#{i}" for i in open_tracks) + ".")
        pending = [t.track_id for t in annotation.tracks if not t.confirmed]
        if pending:
            error(
                f"Còn {len(pending)} người do auto label tạo chưa được xác nhận: "
                + ", ".join(f"#{i}" for i in pending)
                + "."
            )
        if annotation.tracks and not annotation.done:
            warning("Người gán chưa đánh dấu đã gán xong.")
        no_box = [t.track_id for t in annotation.tracks if not t.keyframes]
        if no_box:
            warning(
                "Người " + ", ".join(f"#{i}" for i in no_box) + " chưa có box, cả đoạn sẽ bị bỏ qua khi chấm."
            )
    elif annotation.tracks:
        warning("Phân loại là không có người sử dụng nhưng vẫn có nhãn người. Nhãn này sẽ bị bỏ qua.")


    return GtVideoCheck(
        upload_id=upload.id,
        name=upload.name,
        group=upload.group,
        total_frames=total_frames(upload),
        track_count=len(annotation.tracks),
        issues=issues,
    )


def _ignore_ranges(annotation: Annotation, frame_count: int) -> list[GtIgnore]:
    """Phần đầu và cuối mỗi đoạn nằm ngoài khoảng giữa hai keyframe: có người nhưng chưa có box."""
    result = []
    for track in annotation.tracks:
        for segment in track.segments:
            start, end = segment.start, _segment_end(segment, frame_count)
            if start > end:
                continue
            frames = sorted(f for f in track.keyframes if start <= f <= end)
            if not frames:
                result.append(GtIgnore(track_id=track.track_id, start=start, end=end, reason="Chưa có box"))
                continue
            if frames[0] > start:
                result.append(
                    GtIgnore(track_id=track.track_id, start=start, end=frames[0] - 1, reason="Trước box đầu tiên")
                )
            if frames[-1] < end:
                result.append(
                    GtIgnore(track_id=track.track_id, start=frames[-1] + 1, end=end, reason="Sau box cuối cùng")
                )
    return result


def build_video(upload: Upload, annotation: Annotation, frame_step: int) -> GtVideo:
    frame_count = total_frames(upload)
    using = upload.group == "using"
    events, frames, ignore = [], {}, []

    if using:
        events = [
            GtEvent(track_id=t.track_id, start=s.start, end=_segment_end(s, frame_count))
            for t in annotation.tracks
            for s in t.segments
            if s.start < frame_count
        ]
        frames = {
            frame: [
                GtBox(
                    track_id=box.track_id,
                    bbox=(box.x, box.y, box.w, box.h),
                    source="keyframe" if box.is_keyframe else "interpolated",
                )
                for box in boxes
            ]
            for frame, boxes in expand_to_frames(annotation, frame_count).items()
            # Chỉ giữ frame được chấm, vì các frame liền nhau gần như trùng nhau
            if frame % frame_step == 0
        }
        ignore = _ignore_ranges(annotation, frame_count)

    return GtVideo(
        upload_id=upload.id,
        name=upload.name,
        fps=upload.fps,
        width=upload.width,
        height=upload.height,
        total_frames=frame_count,
        group=upload.group,
        source_annotation_updated_at=annotation.updated_at if using else None,
        events=events,
        frames=frames,
        ignore=ignore,
    )


def build_version(version: str, videos: list[GtVideo], frame_step: int, note: str | None) -> GtVersion:
    stats = GtStats(
        video_count=len(videos),
        eval_frame_count=sum(math.ceil(v.total_frames / frame_step) for v in videos),
        box_count=sum(len(boxes) for v in videos for boxes in v.frames.values()),
        by_group=dict(Counter(v.group for v in videos)),
    )
    return GtVersion(
        gt_version=version,
        created_at=datetime.now(timezone.utc),
        frame_step=frame_step,
        note=(note or "").strip() or None,
        stats=stats,
        videos=videos,
    )
