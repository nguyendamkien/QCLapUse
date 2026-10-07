import { trackColor } from "../../labeling/constants.js";

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/**
 * Danh sách sự kiện đã đánh dấu: số thứ tự người, khoảng thời gian và nút xoá.
 * Thời gian chỉnh bằng cách kéo hai đầu dải màu trên thanh trượt frame.
 */
export default function EventList({
  tracks,
  totalFrames,
  fps,
  selectedTrackId,
  onSelect,
  onSeek,
  onDelete,
  onAccept,
  onAcceptAll,
}) {
  if (tracks.length === 0) return null;

  const lastFrame = Math.max(1, totalFrames - 1);
  const describe = (segment) =>
    `${formatTime(segment.start / fps)} – ${formatTime((segment.end ?? lastFrame) / fps)}`;
  // Track người vẽ có thể chưa có trường confirmed, nên chỉ coi false mới là chưa xác nhận
  const isPending = (track) => track.confirmed === false;
  const pending = tracks.filter(isPending).length;

  return (
    <div className="event-list">
      <div className="event-list-header">
        Sự kiện · {tracks.length}
        {pending > 0 ? (
          <>
            <span className="event-list-hint auto-hint">
              {pending} người do auto label đề xuất: xem lại, sửa nếu cần rồi chấp nhận (phím A)
            </span>
            <button type="button" className="btn btn-small" onClick={onAcceptAll}>
              ✓ Chấp nhận tất cả
            </button>
          </>
        ) : (
          <span className="event-list-hint">Kéo hai đầu dải màu trên thanh trượt để chỉnh thời gian</span>
        )}
      </div>
      <ul>
        {tracks.map((track) => (
          <li
            key={track.track_id}
            className={track.track_id === selectedTrackId ? "event-row selected" : "event-row"}
          >
            <button
              type="button"
              className="event-row-main"
              onClick={() => {
                onSelect(track.track_id);
                onSeek(track.segments[0].start);
              }}
              title={track.segments.map((s) => `Frame ${s.start} – ${s.end ?? "hết video"}`).join("\n")}
            >
              <span className="tool-swatch" style={{ background: trackColor(track.track_id) }} />
              <strong>#{track.track_id}</strong>
              <span className="event-row-range">{track.segments.map(describe).join(", ")}</span>
              {Object.keys(track.keyframes).length === 0 && <span className="event-row-note">chưa có box</span>}
              {isPending(track) && <span className="ai-badge">AI · chưa xác nhận</span>}
            </button>
            {isPending(track) && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => onAccept(track.track_id)}
                aria-label={`Chấp nhận người #${track.track_id} do auto label đề xuất`}
              >
                ✓ Chấp nhận
              </button>
            )}
            <button
              type="button"
              className="btn btn-small btn-danger"
              onClick={() => onDelete(track.track_id)}
              aria-label={`Xóa sự kiện của người #${track.track_id}`}
            >
              Xóa
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
