"""Tracking người bằng ByteTrack (bản có sẵn trong ultralytics), thay cho cách ghép theo ngoại hình.

ByteTrack ghép theo vị trí: lọc Kalman đoán box ở frame sau, rồi ghép theo IoU qua hai lượt:
box điểm cao trước, sau đó box điểm thấp (người bị che một phần, model kém chắc) để giữ các
track chưa ghép được. Không so ngoại hình, nên người đi ngang che người khác dễ bị đổi ID;
bước nối track vụn (stitch_tracks, có so ngoại hình) vẫn chạy sau đó.

Tách khỏi pipeline.py vì cần ultralytics (kéo theo torch), còn pipeline.py là hàm thuần.
"""

from types import SimpleNamespace

from app.services.autolabel.pipeline import Params, PersonTrack, Sample, distinct_people, stitch_tracks


def track_people_bytetrack(samples: list[Sample], params: Params, fps: float = 25.0) -> list[PersonTrack]:
    import numpy as np
    from ultralytics.engine.results import Boxes
    from ultralytics.trackers.byte_tracker import BYTETracker

    # ByteTrack đếm theo số lần cập nhật (frame lấy mẫu), không theo số frame của video
    step = samples[1].frame - samples[0].frame if len(samples) > 1 else 1
    tracker = BYTETracker(
        SimpleNamespace(
            track_high_thresh=params.bytetrack_high_score,
            track_low_thresh=params.bytetrack_low_score,
            # Chỉ tạo track mới từ box đủ chắc chắn, như cách cũ, để không đề xuất nhầm người
            new_track_thresh=params.person_score,
            track_buffer=max(1, round(params.track_max_missed_seconds * fps / step)),
            match_thresh=params.bytetrack_match,
            fuse_score=True,
        )
    )

    tracks: dict[int, PersonTrack] = {}
    for sample in samples:
        people = distinct_people(
            [d for d in sample.detections if d.label == "person" and d.score > params.bytetrack_low_score]
        )
        rows = [(*p.box, p.score, 0) for p in people]
        data = np.array(rows, dtype=np.float32) if rows else np.zeros((0, 6), dtype=np.float32)
        # Mỗi dòng kết quả: x1, y1, x2, y2, track_id, điểm, lớp, chỉ số box đầu vào
        for row in tracker.update(Boxes(data, (1, 1))):
            track_id, index = int(row[4]), int(row[7])
            # Lấy box gốc của detector (không phải box Kalman đã làm mượt) và đặc trưng ngoại hình
            tracks.setdefault(track_id, PersonTrack()).add(sample.frame, people[index])

    return stitch_tracks(list(tracks.values()), params, fps)
