// Các hàm thuần xử lý track. Giữ khớp với services/track_interpolation.py ở backend.
//
// Track: { track_id, segments: [{ start, end }], keyframes: { [frame]: { x, y, w, h } } }
// end = null nghĩa là đoạn chưa kết thúc, kéo dài tới hết video.
// Đoạn có thể chưa có keyframe: mới đánh dấu thời gian xuất hiện, box vẽ sau.

const GEOMETRY_KEYS = ["x", "y", "w", "h"];

const pickGeometry = (box) => Object.fromEntries(GEOMETRY_KEYS.map((k) => [k, box[k]]));

const lerp = (a, b, t) => a + (b - a) * t;

export const containsFrame = (segment, frame) =>
  segment.start <= frame && (segment.end == null || frame <= segment.end);

export const segmentAt = (track, frame) => track.segments.find((s) => containsFrame(s, frame)) ?? null;

const keyframeNumbers = (track) =>
  Object.keys(track.keyframes)
    .map(Number)
    .sort((a, b) => a - b);

/**
 * Box của track tại frame: { x, y, w, h, isKeyframe }.
 * Chỉ nội suy giữa hai keyframe gần nhất trong cùng đoạn. Frame trước keyframe đầu,
 * sau keyframe cuối hoặc ngoài mọi đoạn thì chưa có box (null).
 */
export function boxAt(track, frame) {
  const segment = segmentAt(track, frame);
  if (!segment) return null;
  if (track.keyframes[frame]) return { ...track.keyframes[frame], isKeyframe: true };

  const frames = keyframeNumbers(track).filter((f) => containsFrame(segment, f));
  if (frames.length === 0) return null;
  const after = frames.find((f) => f > frame);
  const before = [...frames].reverse().find((f) => f < frame);
  if (before == null || after == null) return null;

  const a = track.keyframes[before];
  const b = track.keyframes[after];
  const t = (frame - before) / (after - before);
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
    isKeyframe: false,
  };
}

export const nextTrackId = (tracks) => tracks.reduce((max, t) => Math.max(max, t.track_id), 0) + 1;

/** Đặt (hoặc sửa) keyframe tại frame. Frame phải nằm trong một đoạn của track. */
export function setKeyframe(track, frame, box) {
  if (!segmentAt(track, frame)) return track;
  return { ...track, keyframes: { ...track.keyframes, [frame]: pickGeometry(box) } };
}

/** Giữ box nội suy tại frame làm keyframe, dùng trước khi cắt đoạn để không mất vị trí. */
function pinKeyframe(track, frame) {
  const box = boxAt(track, frame);
  return box ? setKeyframe(track, frame, box) : track;
}

/** Kết thúc đoạn chứa frame tại chính frame đó (frame vẫn thuộc đoạn). */
export function endSegmentAt(track, frame) {
  const segment = segmentAt(track, frame);
  if (!segment) return track;
  const pinned = pinKeyframe(track, frame);
  const keyframes = Object.fromEntries(
    Object.entries(pinned.keyframes).filter(([f]) => !(Number(f) > frame && containsFrame(segment, Number(f))))
  );
  const segments = pinned.segments.map((s) => (s === segment ? { ...s, end: frame } : s));
  return { ...pinned, segments, keyframes };
}

/**
 * Dời điểm bắt đầu của đoạn về frame. Frame trong đoạn thì cắt bỏ phần trước,
 * frame trước đoạn thì kéo dài đoạn ra (không đè lên đoạn phía trước).
 */
export function startSegmentAt(track, frame) {
  const inside = segmentAt(track, frame);
  if (inside) {
    const pinned = pinKeyframe(track, frame);
    const keyframes = Object.fromEntries(
      Object.entries(pinned.keyframes).filter(([f]) => !(Number(f) < frame && containsFrame(inside, Number(f))))
    );
    const segments = pinned.segments.map((s) => (s === inside ? { ...s, start: frame } : s));
    return { ...pinned, segments, keyframes };
  }

  // Frame nằm ngoài mọi đoạn nên kéo đoạn kế tiếp về đây không đè lên đoạn nào
  const next = track.segments.find((s) => s.start > frame);
  if (!next) return track;
  const segments = track.segments.map((s) => (s === next ? { ...s, start: frame } : s));
  return { ...track, segments };
}

/** Xoá keyframe tại frame. Xoá hết box của một đoạn thì đoạn vẫn giữ lại như một sự kiện. */
export function deleteKeyframe(track, frame) {
  if (!track.keyframes[frame]) return track;
  const { [frame]: _removed, ...keyframes } = track.keyframes;
  return { ...track, keyframes };
}

/** Tạo người mới chỉ có một đoạn xuất hiện, chưa có box (đánh dấu bằng phím Space). */
export const createEventTrack = (tracks, start, end) => ({
  track_id: nextTrackId(tracks),
  segments: [{ start, end }],
  keyframes: {},
});

/** Keyframe gần nhất trước / sau frame của track (dùng cho phím [ và ]). */
export function neighborKeyframe(track, frame, direction) {
  const frames = keyframeNumbers(track);
  return direction < 0 ? [...frames].reverse().find((f) => f < frame) ?? null : frames.find((f) => f > frame) ?? null;
}

/**
 * Đặt lại frame bắt đầu / kết thúc cho đoạn thứ index (các đoạn đã sắp theo start).
 * Giữ start <= end và không đè lên đoạn khác của cùng người.
 * Keyframe nằm ngoài khoảng mới của đoạn này bị bỏ.
 */
export function setSegmentBounds(track, index, start, end) {
  const segment = track.segments[index];
  if (!segment) return track;
  const previous = track.segments[index - 1];
  const next = track.segments[index + 1];
  const min = previous ? previous.end + 1 : 0;
  const max = next ? next.start - 1 : Infinity;

  const newEnd = end == null ? (next ? max : null) : Math.min(Math.max(end, min), max);
  const newStart = Math.min(Math.max(start, min), newEnd ?? Infinity);
  const updated = { start: newStart, end: newEnd };

  const keyframes = Object.fromEntries(
    Object.entries(track.keyframes).filter(
      ([f]) => !containsFrame(segment, Number(f)) || containsFrame(updated, Number(f))
    )
  );
  const segments = track.segments.map((s, i) => (i === index ? updated : s));
  return { ...track, segments, keyframes };
}

/**
 * Đánh số lại các người thành 1, 2, 3... theo thứ tự hiện tại (dùng sau khi xoá).
 * Màu đi theo số thứ tự nên cũng đổi theo. Trả về danh sách mới và bảng số cũ → số mới.
 */
export function renumberTracks(tracks) {
  const ordered = [...tracks].sort((a, b) => a.track_id - b.track_id);
  const idMap = new Map(ordered.map((t, i) => [t.track_id, i + 1]));
  return {
    tracks: ordered.map((t) => ({ ...t, track_id: idMap.get(t.track_id) })),
    idMap,
  };
}
