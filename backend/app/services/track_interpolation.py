"""Tính box ở các frame giữa hai keyframe bằng nội suy tuyến tính.

Ví dụ keyframe ở frame 10 có x = 0.2 và ở frame 20 có x = 0.4, thì frame 15 có x = 0.3.
Cùng một logic cũng có ở frontend (src/labeling/tracks.js) để vẽ box khi đang gán.
"""

from bisect import bisect_left

from app.schemas.annotation import Annotation, BoxGeometry, FrameBox, Track


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def box_at(track: Track, frame: int) -> tuple[BoxGeometry, bool] | None:
    """Box của track tại một frame và frame đó có phải keyframe không.

    Chỉ nội suy tuyến tính giữa hai keyframe gần nhất trong cùng đoạn. Frame trước
    keyframe đầu tiên, sau keyframe cuối cùng, hoặc nằm ngoài mọi đoạn thì chưa có box (None).
    """
    segment = next((s for s in track.segments if s.contains(frame)), None)
    if segment is None:
        return None
    if frame in track.keyframes:
        return track.keyframes[frame], True

    frames = sorted(f for f in track.keyframes if segment.contains(f))
    if not frames:
        return None
    index = bisect_left(frames, frame)
    if index == 0 or index == len(frames):
        return None

    before, after = frames[index - 1], frames[index]
    a, b = track.keyframes[before], track.keyframes[after]
    # t đi từ 0 (tại keyframe trước) tới 1 (tại keyframe sau)
    t = (frame - before) / (after - before)
    return (
        BoxGeometry(
            x=_lerp(a.x, b.x, t),
            y=_lerp(a.y, b.y, t),
            w=_lerp(a.w, b.w, t),
            h=_lerp(a.h, b.h, t),
        ),
        False,
    )


def expand_to_frames(annotation: Annotation, total_frames: int) -> dict[int, list[FrameBox]]:
    """Bung các track thành danh sách box cho từng frame, dùng khi tạo GT.

    Frame chưa có box (ngoài khoảng giữa hai keyframe) thì bỏ qua, vì chưa biết vị trí người.
    """
    result: dict[int, list[FrameBox]] = {}
    for track in annotation.tracks:
        for segment in track.segments:
            last = total_frames - 1 if segment.end is None else min(segment.end, total_frames - 1)
            for frame in range(segment.start, last + 1):
                found = box_at(track, frame)
                if found is None:
                    continue
                box, is_keyframe = found
                result.setdefault(frame, []).append(
                    FrameBox(**box.model_dump(), track_id=track.track_id, is_keyframe=is_keyframe)
                )
    return dict(sorted(result.items()))
