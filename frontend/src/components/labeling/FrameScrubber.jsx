import { useRef, useState } from "react";
import { trackColor } from "../../labeling/constants.js";

const TARGET_TICKS = 10;
const NICE_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const BASE_HEIGHT = 22;
const LANE_HEIGHT = 18;
const MAX_HEIGHT = 166;
const PADDING = 2;

function formatSeconds(total) {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Thanh trượt frame. Mỗi sự kiện (người) một dải màu riêng, thanh cao dần theo số sự kiện.
 * Bấm hoặc kéo trên thanh để tua, bấm vào dải để chọn người đó,
 * kéo hai đầu dải để chỉnh thời gian bắt đầu / kết thúc. Đoạn đang đánh dấu bằng Space hiện sọc.
 */
export default function FrameScrubber({
  totalFrames,
  currentFrame,
  fps,
  tracks,
  selectedTrackId,
  recording,
  onSeek,
  onSelect,
  onChangeSegment,
}) {
  const barRef = useRef(null);
  const seeking = useRef(false);
  // Đầu dải đang kéo: { trackId, index, edge: "start" | "end", start, end, open }
  const edgeRef = useRef(null);
  const [edgeDrag, setEdgeDrag] = useState(null);

  const lastFrame = Math.max(1, totalFrames - 1);
  const percent = (frame) => (Math.min(Math.max(frame, 0), lastFrame) / lastFrame) * 100;

  const frameFromEvent = (event) => {
    const rect = barRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return Math.round(ratio * lastFrame);
  };

  // Mỗi người một dải, thêm một dải cho sự kiện đang đánh dấu
  const laneCount = tracks.length + (recording ? 1 : 0);
  const laneHeight =
    laneCount === 0 ? 0 : Math.min(LANE_HEIGHT, (MAX_HEIGHT - PADDING * 2) / laneCount);
  const barHeight = laneCount === 0 ? BASE_HEIGHT : Math.max(BASE_HEIGHT, laneCount * laneHeight + PADDING * 2);
  const laneTop = (index) => PADDING + index * laneHeight;

  const seconds = totalFrames / fps;
  const tickEvery = NICE_SECONDS.find((s) => seconds / s <= TARGET_TICKS) ?? NICE_SECONDS.at(-1);
  const ticks = [];
  for (let t = 0; t <= seconds; t += tickEvery) ticks.push(t);

  // ---------- Kéo đầu dải ----------
  const startEdgeDrag = (event, track, index, edge) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    barRef.current.setPointerCapture(event.pointerId);
    const segment = track.segments[index];
    const state = {
      trackId: track.track_id,
      index,
      edge,
      start: segment.start,
      end: segment.end ?? lastFrame,
      open: segment.end == null,
    };
    edgeRef.current = state;
    setEdgeDrag(state);
    onSelect(track.track_id);
  };

  const handlePointerMove = (event) => {
    const current = edgeRef.current;
    if (current) {
      const frame = frameFromEvent(event);
      const next =
        current.edge === "start"
          ? { ...current, start: Math.min(frame, current.end) }
          : { ...current, end: Math.max(frame, current.start) };
      edgeRef.current = next;
      setEdgeDrag(next);
      onSeek(current.edge === "start" ? next.start : next.end);
    } else if (seeking.current) {
      onSeek(frameFromEvent(event));
    }
  };

  const handlePointerUp = () => {
    seeking.current = false;
    const current = edgeRef.current;
    if (!current) return;
    edgeRef.current = null;
    setEdgeDrag(null);
    // Đoạn chưa kết thúc mà chỉ kéo mép bắt đầu thì vẫn giữ là chưa kết thúc
    const end = current.edge === "start" && current.open ? null : current.end;
    onChangeSegment(current.trackId, current.index, current.start, end);
  };

  // Trong lúc kéo thì hiện khoảng mới thay cho khoảng đã lưu
  const boundsOf = (track, index) => {
    const segment = track.segments[index];
    if (edgeDrag && edgeDrag.trackId === track.track_id && edgeDrag.index === index) {
      return { start: edgeDrag.start, end: edgeDrag.end };
    }
    return { start: segment.start, end: segment.end ?? lastFrame };
  };

  const recordingFrom = recording ? Math.min(recording.start, currentFrame) : 0;
  const recordingTo = recording ? Math.max(recording.start, currentFrame) : 0;

  return (
    <div className="scrubber">
      <div
        ref={barRef}
        className="scrubber-bar"
        style={{ height: barHeight }}
        role="slider"
        tabIndex={-1}
        aria-label="Frame"
        aria-valuemin={0}
        aria-valuemax={lastFrame}
        aria-valuenow={currentFrame}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          seeking.current = true;
          barRef.current.setPointerCapture(event.pointerId);
          onSeek(frameFromEvent(event));
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {tracks.map((track, lane) =>
          track.segments.map((segment, index) => {
            const { start, end } = boundsOf(track, index);
            const selected = track.track_id === selectedTrackId;
            return (
              <span
                key={`${track.track_id}-${index}`}
                className={selected ? "scrubber-segment selected" : "scrubber-segment"}
                style={{
                  left: `${percent(start)}%`,
                  width: `calc(${percent(end) - percent(start)}% + 2px)`,
                  top: laneTop(lane),
                  height: laneHeight - 2,
                  background: trackColor(track.track_id),
                }}
                title={`Người #${track.track_id}: frame ${start} – ${segment.end == null && !edgeDrag ? "hết video" : end}`}
                onPointerDown={() => onSelect(track.track_id)}
              >
                {["start", "end"].map((edge) => (
                  <span
                    key={edge}
                    className={`segment-handle handle-${edge}`}
                    role="slider"
                    aria-label={`${edge === "start" ? "Bắt đầu" : "Kết thúc"} sự kiện của người #${track.track_id}`}
                    aria-valuenow={edge === "start" ? start : end}
                    onPointerDown={(event) => startEdgeDrag(event, track, index, edge)}
                  />
                ))}
              </span>
            );
          })
        )}

        {tracks.map((track, lane) =>
          Object.keys(track.keyframes).map((frame) => (
            <span
              key={`${track.track_id}-kf-${frame}`}
              className="scrubber-keyframe"
              style={{ left: `${percent(Number(frame))}%`, top: laneTop(lane) + (laneHeight - 2) / 2 }}
              title={`Người #${track.track_id}: box ở frame ${frame}`}
            />
          ))
        )}

        {recording && (
          <span
            className="scrubber-recording"
            style={{
              left: `${percent(recordingFrom)}%`,
              width: `calc(${percent(recordingTo) - percent(recordingFrom)}% + 2px)`,
              top: laneTop(tracks.length),
              height: laneHeight - 2,
              "--recording-color": recording.color,
            }}
          />
        )}

        <span className="scrubber-playhead" style={{ left: `${percent(currentFrame)}%` }} />
      </div>

      <div className="scrubber-ticks" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: `${percent(t * fps)}%` }}>
            {formatSeconds(t)}
          </span>
        ))}
      </div>
    </div>
  );
}
