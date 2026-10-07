"""Biến kết quả phát hiện ở từng frame thành nhãn nháp: track, đoạn, keyframe.

Các bước (xem doc/auto-label.md):
    1. Phát hiện người và thiết bị ở các frame lấy mẫu (detector.py làm, không nằm ở đây)
    2. Tracking: nối box của cùng một người qua các frame lấy mẫu. Mặc định dùng ByteTrack
       (bytetrack.py); Params.tracker = "appearance" dùng cách cũ (vị trí + màu áo, quần)
    3. Người có đang dùng máy không: box thiết bị nằm trong box người (nới rộng một chút)
    4. Tạo đoạn: gộp các frame "đang dùng" liền nhau, lấp khoảng hở ngắn, bỏ đoạn quá ngắn.
       Mỗi đoạn liên tục là một track riêng: bị ngắt (ngừng dùng máy lâu hơn khoảng hở cho phép)
       rồi dùng lại thì thành track mới, kể cả khi vẫn là cùng một người
    5. Chọn keyframe: giữ ít box nhất sao cho nội suy tuyến tính vẫn khớp với box phát hiện

Toàn bộ là hàm thuần, không cần torch, nên test được bằng dữ liệu giả.
Box trong file này là (x1, y1, x2, y2) theo pixel; chỉ khi xuất ra mới chuẩn hoá 0 đến 1.
"""

from dataclasses import dataclass, field

Box = tuple[float, float, float, float]


@dataclass
class Detection:
    label: str
    score: float
    box: Box
    # Đặc trưng ngoại hình (histogram màu phần thân, tổng bằng 1), chỉ có ở box người.
    # Dùng để không ghép nhầm hai người khác nhau khi họ đi ngang che khuất nhau.
    feature: tuple[float, ...] | None = None


@dataclass
class Sample:
    """Kết quả phát hiện ở một frame lấy mẫu."""

    frame: int
    detections: list[Detection]


@dataclass
class Params:
    person_score: float = 0.6
    device_score: float = 0.3
    # Chỉ phát hiện laptop (không tính bàn phím / chuột của máy để bàn). Muốn tính cả người dùng
    # máy để bàn thì thêm "keyboard", "mouse" (tên lớp trong bộ COCO)
    device_labels: tuple[str, ...] = ("laptop",)
    # Thiết bị cố định (trên bàn) phải được thấy ở ít nhất tỷ lệ này trong các frame lấy mẫu
    static_min_ratio: float = 0.1
    # Thiết bị chỉ thấy ở frame hiện tại (ví dụ laptop đang được cầm) cần điểm cao hơn
    moving_device_score: float = 0.6
    # Tỷ lệ diện tích thiết bị nằm trong box người (nới rộng person_margin) để coi là đang dùng
    use_overlap: float = 0.3
    person_margin: float = 0.1
    # Tâm thiết bị phải nằm trong khoảng chiều cao này của box người (0 là đỉnh đầu, 1 là chân):
    # laptop đang dùng nằm trước thân người, không phải ngang đầu hay sau lưng
    device_min_height: float = 0.25
    device_max_height: float = 0.95
    # Ghép người với track khi box chồng nhau đủ (IoU), hoặc khi người di chuyển nhanh làm IoU
    # thấp nhưng tâm box dịch ít hơn tỷ lệ này so với đường chéo box cũ và kích thước gần giống
    track_iou: float = 0.3
    track_max_shift: float = 0.3
    track_max_size_change: float = 2.0
    # Ngoại hình (màu áo, quần) phải giống ít nhất mức này (0 đến 1) mới được ghép. Đo trên video
    # mẫu: cùng một người ở hai frame liền nhau thì 95% trên 0,95; hai người khác nhau cao nhất 0,85
    track_min_appearance: float = 0.88
    # Nối hai đoạn track vụn của cùng một người: cách nhau không quá chừng này giây, ngoại hình
    # trung bình giống ít nhất stitch_min_appearance, tâm box dịch không quá stitch_max_shift.
    # Để chặt vì nối nhầm hai người còn tệ hơn để track bị cắt vụn.
    stitch_max_gap_seconds: float = 3.0
    stitch_min_appearance: float = 0.92
    stitch_max_shift: float = 1.0
    # Mất dấu lâu hơn chừng này giây thì kết thúc track. Nhờ so ngoại hình, người bị che khuất
    # một lúc rồi hiện lại vẫn giữ được track cũ
    track_max_missed_seconds: float = 2.0
    # Cách tracking: "bytetrack" (mặc định, bytetrack.py) hoặc "appearance" (track_people bên dưới)
    tracker: str = "bytetrack"
    # ByteTrack: box người điểm >= high ghép ở lượt 1; điểm trong (low, high) chỉ dùng ở lượt 2 để
    # giữ track đang có (không tạo track mới). match là ngưỡng khoảng cách (1 - IoU) khi ghép.
    bytetrack_high_score: float = 0.5
    bytetrack_low_score: float = 0.1
    bytetrack_match: float = 0.8
    max_gap_seconds: float = 1.0
    min_segment_seconds: float = 1.0
    keyframe_iou: float = 0.8
    smooth_window: int = 3


def area(box: Box) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def intersection(a: Box, b: Box) -> float:
    return area((max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])))


def iou(a: Box, b: Box) -> float:
    inter = intersection(a, b)
    union = area(a) + area(b) - inter
    return inter / union if union > 0 else 0.0


def overlap_ratio(inner: Box, outer: Box) -> float:
    """Phần diện tích của inner nằm trong outer."""
    return intersection(inner, outer) / area(inner) if area(inner) > 0 else 0.0


def expand(box: Box, margin: float) -> Box:
    dx, dy = (box[2] - box[0]) * margin, (box[3] - box[1]) * margin
    return (box[0] - dx, box[1] - dy, box[2] + dx, box[3] + dy)


def lerp_box(a: Box, b: Box, t: float) -> Box:
    return tuple(p + (q - p) * t for p, q in zip(a, b))


def center_shift(previous: Box, current: Box) -> float:
    """Khoảng cách giữa hai tâm box, tính theo đường chéo của box trước."""
    px, py = (previous[0] + previous[2]) / 2, (previous[1] + previous[3]) / 2
    cx, cy = (current[0] + current[2]) / 2, (current[1] + current[3]) / 2
    diagonal = ((previous[2] - previous[0]) ** 2 + (previous[3] - previous[1]) ** 2) ** 0.5
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5 / diagonal if diagonal > 0 else float("inf")


# ---------------------------------------------------------------- 2. Tracking


@dataclass
class PersonTrack:
    # Mỗi phần tử: (frame, box, điểm tin cậy)
    points: list[tuple[int, Box, float]] = field(default_factory=list)
    # Ngoại hình trung bình trượt của người này qua các frame
    feature: tuple[float, ...] | None = None

    def add(self, frame: int, person: Detection) -> None:
        self.points.append((frame, person.box, person.score))
        if person.feature is None:
            return
        if self.feature is None:
            self.feature = person.feature
        else:
            # Trộn chậm để một frame bị che một phần không làm lệch ngoại hình của track
            self.feature = tuple(0.7 * a + 0.3 * b for a, b in zip(self.feature, person.feature))


def appearance(a: tuple[float, ...] | None, b: tuple[float, ...] | None) -> float | None:
    """Độ giống hai histogram màu (hệ số Bhattacharyya): 1 là giống hệt, 0 là khác hẳn."""
    if a is None or b is None:
        return None
    return sum((p * q) ** 0.5 for p, q in zip(a, b))


def distinct_people(people: list[Detection], contained: float = 0.7) -> list[Detection]:
    """Bỏ box người nằm gần trọn trong box người lớn hơn.

    Detector đôi khi trả thêm một box nửa người trên cho cùng một người, sinh ra track trùng.
    """
    ordered = sorted(people, key=lambda d: area(d.box), reverse=True)
    kept: list[Detection] = []
    for person in ordered:
        if all(overlap_ratio(person.box, other.box) < contained for other in kept):
            kept.append(person)
    return kept


def track_people(samples: list[Sample], params: Params, fps: float = 25.0) -> list[PersonTrack]:
    """Ghép người ở frame sau với track ở frame trước (ghép tham lam theo điểm giống nhau).

    Một cặp (track, người) chỉ được xét khi thoả cả hai điều kiện:
      - vị trí: box chồng nhau đủ (IoU), hoặc tâm dịch ít và kích thước gần giống
        (người di chuyển nhanh giữa hai frame lấy mẫu)
      - ngoại hình: màu phần thân đủ giống. Đây là điều kiện chặn lỗi đổi người khi một người
        đi ngang che khuất người khác: vị trí thì chồng nhau nhưng màu áo khác hẳn.
    Các cặp hợp lệ được ghép lần lượt từ cặp giống nhau nhất.
    """
    max_missed_frames = round(params.track_max_missed_seconds * fps)
    active: list[PersonTrack] = []
    finished: list[PersonTrack] = []

    def size_ratio(a: Box, b: Box) -> float:
        big, small = max(area(a), area(b)), min(area(a), area(b))
        return big / small if small > 0 else float("inf")

    def match_score(track: PersonTrack, person: Detection) -> float | None:
        last = track.points[-1][1]
        overlap, shift = iou(last, person.box), center_shift(last, person.box)
        near = overlap >= params.track_iou or (
            shift <= params.track_max_shift and size_ratio(last, person.box) <= params.track_max_size_change
        )
        similar = appearance(track.feature, person.feature)
        if not near or (similar is not None and similar < params.track_min_appearance):
            return None
        return overlap - shift + (similar or 0)

    for sample in samples:
        people = distinct_people(
            [d for d in sample.detections if d.label == "person" and d.score >= params.person_score]
        )
        candidates = sorted(
            (
                (score, ti, pi)
                for ti, track in enumerate(active)
                for pi, person in enumerate(people)
                if (score := match_score(track, person)) is not None
            ),
            reverse=True,
        )

        used_tracks, used_people = set(), set()
        for _, ti, pi in candidates:
            if ti in used_tracks or pi in used_people:
                continue
            active[ti].add(sample.frame, people[pi])
            used_tracks.add(ti)
            used_people.add(pi)

        still_active = [t for t in active if sample.frame - t.points[-1][0] <= max_missed_frames]
        finished += [t for t in active if sample.frame - t.points[-1][0] > max_missed_frames]
        active = still_active
        for pi, person in enumerate(people):
            if pi not in used_people:
                track = PersonTrack()
                track.add(sample.frame, person)
                active.append(track)

    return stitch_tracks(finished + active, params, fps)


def stitch_tracks(tracks: list[PersonTrack], params: Params, fps: float) -> list[PersonTrack]:
    """Nối các đoạn track vụn của cùng một người thành một track.

    Khi bị che khuất lâu hoặc màu áo đổi tạm thời, một người có thể bị tách thành nhiều track
    nối tiếp nhau. Nối track B vào sau track A nếu B bắt đầu sau khi A kết thúc không lâu,
    ngoại hình trung bình rất giống và vị trí không nhảy quá xa. Chỉ nối khi có ngoại hình để
    so, vì chỉ dựa vào vị trí thì dễ nối nhầm hai người.
    """
    max_gap = round(params.stitch_max_gap_seconds * fps)
    ordered = sorted(tracks, key=lambda t: t.points[0][0])
    result: list[PersonTrack] = []
    for track in ordered:
        start_frame, start_box, _ = track.points[0]
        best, best_score = None, None
        for previous in result:
            end_frame, end_box, _ = previous.points[-1]
            similar = appearance(previous.feature, track.feature)
            if not (0 < start_frame - end_frame <= max_gap) or similar is None:
                continue
            shift = center_shift(end_box, start_box)
            if similar < params.stitch_min_appearance or shift > params.stitch_max_shift:
                continue
            if best_score is None or similar - shift > best_score:
                best, best_score = previous, similar - shift
        if best is None:
            result.append(track)
            continue
        best.points += track.points
        best.feature = tuple(0.5 * a + 0.5 * b for a, b in zip(best.feature, track.feature))
    return result


# ---------------------------------------------------------------- 3. Đang dùng máy?


def static_devices(samples: list[Sample], params: Params) -> list[Box]:
    """Thiết bị đặt cố định (laptop mở trên bàn), gom từ mọi frame lấy mẫu.

    Camera đứng yên nên thiết bị trên bàn luôn ở một chỗ. Gom các lần phát hiện chồng
    lên nhau thành một cụm: frame nào detector bỏ sót thì vẫn biết chỗ đó có thiết bị.
    """
    clusters: list[list[Box]] = []
    for sample in samples:
        for d in sample.detections:
            if d.label not in params.device_labels or d.score < params.device_score:
                continue
            for cluster in clusters:
                if iou(cluster[0], d.box) >= 0.3:
                    cluster.append(d.box)
                    break
            else:
                clusters.append([d.box])

    min_count = max(2, round(params.static_min_ratio * len(samples)))
    return [
        tuple(sum(b[i] for b in cluster) / len(cluster) for i in range(4))
        for cluster in clusters
        if len(cluster) >= min_count
    ]


def is_using(person: Box, devices: list[Box], params: Params) -> bool:
    """Có thiết bị nằm trong tầm với của người, ở phần thân (không phải ngang đầu)."""
    reach = expand(person, params.person_margin)
    height = person[3] - person[1]

    def at_body(device: Box) -> bool:
        center_y = (device[1] + device[3]) / 2
        relative = (center_y - person[1]) / height if height > 0 else 0
        return params.device_min_height <= relative <= params.device_max_height

    return any(overlap_ratio(device, reach) >= params.use_overlap and at_body(device) for device in devices)


# ---------------------------------------------------------------- 4. Tạo đoạn


def runs_to_segments(
    frames: list[int], flags: list[bool], max_gap: int, min_length: int
) -> list[tuple[int, int]]:
    """Các khoảng frame liên tục có flag True. Lấp khoảng hở <= max_gap, bỏ đoạn ngắn hơn min_length."""
    runs: list[list[int]] = []
    for frame, flag in zip(frames, flags):
        if not flag:
            continue
        if runs and frame - runs[-1][1] <= max_gap:
            runs[-1][1] = frame
        else:
            runs.append([frame, frame])
    return [(start, end) for start, end in runs if end - start >= min_length]


def smooth(points: list[tuple[int, Box, float]], window: int) -> list[tuple[int, Box, float]]:
    """Trung bình trượt toạ độ box để bớt rung, tránh sinh quá nhiều keyframe."""
    half = window // 2
    result = []
    for i, (frame, _, score) in enumerate(points):
        neighbours = [b for _, b, _ in points[max(0, i - half) : i + half + 1]]
        result.append((frame, tuple(sum(b[k] for b in neighbours) / len(neighbours) for k in range(4)), score))
    return result


# ---------------------------------------------------------------- 5. Chọn keyframe


def select_keyframes(points: list[tuple[int, Box, float]], min_iou: float) -> list[int]:
    """Chỉ số các điểm cần giữ làm keyframe.

    Giữ điểm đầu và cuối; nếu có điểm ở giữa mà box nội suy lệch nhiều (IoU < min_iou)
    so với box phát hiện thì giữ điểm lệch nhất rồi xét tiếp hai nửa (giống thuật toán
    đơn giản hoá đường Ramer–Douglas–Peucker).
    """
    if len(points) <= 2:
        return list(range(len(points)))

    def split(lo: int, hi: int) -> list[int]:
        (f0, b0, _), (f1, b1, _) = points[lo], points[hi]
        worst, worst_iou = None, min_iou
        for i in range(lo + 1, hi):
            frame, box, _ = points[i]
            value = iou(box, lerp_box(b0, b1, (frame - f0) / (f1 - f0)))
            if value < worst_iou:
                worst, worst_iou = i, value
        if worst is None:
            return []
        return split(lo, worst) + [worst] + split(worst, hi)

    return [0] + split(0, len(points) - 1) + [len(points) - 1]


# ---------------------------------------------------------------- Gộp lại


def normalize(box: Box, width: int, height: int, score: float) -> dict:
    x1, y1 = min(max(box[0], 0), width - 1), min(max(box[1], 0), height - 1)
    x2, y2 = min(max(box[2], x1 + 1), width), min(max(box[3], y1 + 1), height)
    return {
        "x": x1 / width,
        "y": y1 / height,
        "w": (x2 - x1) / width,
        "h": (y2 - y1) / height,
        "confidence": round(score, 3),
    }


def build_tracks(
    samples: list[Sample], width: int, height: int, fps: float, params: Params, first_track_id: int = 1
) -> list[dict]:
    """Nhãn nháp theo đúng định dạng Track trong schemas/annotation.py (origin=auto, chưa xác nhận).

    Mỗi đoạn liên tục một track, mỗi track đúng một đoạn. Khoảng hở ngắn (<= max_gap_seconds, thường
    do model bỏ sót vài frame) vẫn được lấp nên không tách track.
    """
    fixed = static_devices(samples, params)
    moving_by_frame = {
        s.frame: [d.box for d in s.detections if d.label in params.device_labels and d.score >= params.moving_device_score]
        for s in samples
    }
    max_gap = round(params.max_gap_seconds * fps)
    min_length = round(params.min_segment_seconds * fps)

    if params.tracker == "bytetrack":
        from app.services.autolabel.bytetrack import track_people_bytetrack

        people = track_people_bytetrack(samples, params, fps)
    else:
        people = track_people(samples, params, fps)

    tracks = []
    for person in people:
        frames = [frame for frame, _, _ in person.points]
        flags = [is_using(box, fixed + moving_by_frame[frame], params) for frame, box, _ in person.points]
        for start, end in runs_to_segments(frames, flags, max_gap, min_length):
            points = smooth([p for p in person.points if start <= p[0] <= end], params.smooth_window)
            keyframes = {}
            for i in select_keyframes(points, params.keyframe_iou):
                frame, box, score = points[i]
                keyframes[frame] = normalize(box, width, height, score)
            tracks.append(
                {
                    "segments": [{"start": start, "end": end}],
                    "keyframes": keyframes,
                    "origin": "auto",
                    "confirmed": False,
                }
            )
    # Đánh số theo thời điểm bắt đầu, để danh sách sự kiện trên trang Gán nhãn xếp đúng thứ tự thời gian
    tracks.sort(key=lambda t: t["segments"][0]["start"])
    for i, track in enumerate(tracks):
        track["track_id"] = first_track_id + i
    return tracks
