import { useEffect, useRef, useState } from "react";
import { videoUrl } from "../../api/client.js";
import { GROUPS, groupName } from "../../classification/constants.js";

const SPEEDS = [1, 1.5, 2, 3];
const SEEK_STEP = 2;
const SPEED_KEY = "classify.speed";

function readSpeed() {
  try {
    const value = Number(localStorage.getItem(SPEED_KEY));
    return SPEEDS.includes(value) ? value : 1.5;
  } catch {
    return 1.5;
  }
}

function writeSpeed(speed) {
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    // Trình duyệt chặn localStorage thì chỉ không nhớ được tốc độ
  }
}

const isTyping = (target) => ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);

/**
 * Xem lần lượt từng video và phân loại bằng phím tắt, xong video nào tự sang video kế tiếp.
 * Danh sách ids cố định từ lúc mở, nên video vừa phân loại không bị rút khỏi hàng đợi.
 */
export default function QuickClassifier({ ids, startIndex, uploadsById, onClassify, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const [history, setHistory] = useState([]);
  const [speed, setSpeed] = useState(readSpeed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef(null);

  const current = index < ids.length ? uploadsById.get(ids[index]) : null;

  useEffect(() => {
    setError("");
  }, [index]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = video.defaultPlaybackRate = speed;
    writeSpeed(speed);
  }, [speed]);

  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Chọn nhóm là lưu luôn và sang video kế tiếp
  const decide = (group) =>
    run(async () => {
      await onClassify([current.id], group);
      setHistory((h) => [...h, { id: current.id, index, group: current.group }]);
      setIndex((i) => i + 1);
    });

  // Trả video vừa phân loại về nhóm cũ
  const undo = () => {
    const last = history.at(-1);
    if (!last) return;
    run(async () => {
      await onClassify([last.id], last.group ?? null);
      setHistory((h) => h.slice(0, -1));
      setIndex(last.index);
    });
  };

  const go = (delta) => setIndex((i) => Math.min(ids.length, Math.max(0, i + delta)));

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  const seek = (delta) => {
    const video = videoRef.current;
    if (video) video.currentTime = Math.max(0, video.currentTime + delta);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();

      if (key === "escape") {
        onClose();
        return;
      }
      if (!current) return;

      const group = GROUPS.find((g) => g.key === key);
      if (group) {
        decide(group.value);
      } else if (key === " ") {
        event.preventDefault();
        togglePlay();
      } else if (key === "arrowleft") {
        event.preventDefault();
        seek(-SEEK_STEP);
      } else if (key === "arrowright") {
        event.preventDefault();
        seek(SEEK_STEP);
      } else if (key === "s") {
        go(1);
      } else if (key === "z") {
        undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="quick-overlay" role="dialog" aria-modal="true" aria-label="Phân loại nhanh">
      <div className="quick-window">
        <div className="quick-header">
          <strong>Phân loại nhanh</strong>
          <span className="quick-progress">
            {Math.min(index + 1, ids.length)} / {ids.length}
          </span>
          <div className="quick-progress-bar" aria-hidden="true">
            <span style={{ width: `${(index / ids.length) * 100}%` }} />
          </div>
          <button type="button" className="btn btn-small" onClick={onClose} title="Esc">
            Đóng
          </button>
        </div>

        {!current ? (
          <div className="quick-done">
            <p className="quick-done-title">Đã xem hết {ids.length} video</p>
            <p>Đã phân loại {history.length} video trong lượt này.</p>
            <div className="quick-done-actions">
              {history.length > 0 && (
                <button type="button" className="btn btn-small" onClick={undo} disabled={busy}>
                  Hoàn tác video cuối (Z)
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Xong
              </button>
            </div>
          </div>
        ) : (
          <div className="quick-body">
            <div className="quick-player">
              <video
                ref={videoRef}
                key={current.id}
                src={videoUrl(current.id)}
                controls
                autoPlay
                muted
                playsInline
                onLoadedMetadata={(e) => {
                  e.currentTarget.playbackRate = e.currentTarget.defaultPlaybackRate = speed;
                }}
              />
              <div className="quick-speed">
                Tốc độ
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={s === speed ? "speed-button active" : "speed-button"}
                    onClick={() => setSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            <aside className="quick-panel">
              <div className="quick-name" title={current.name}>
                {current.name}
              </div>
              <div className="quick-current">
                <span>Đang ở: {groupName(current.group)}</span>
              </div>
              {!current.group && current.suggested_group && (
                <p className="quick-suggest">Gợi ý từ tên thư mục: {groupName(current.suggested_group)}</p>
              )}

              <div className="quick-step-title">Chọn nhóm (lưu và sang video kế tiếp)</div>
              <div className="quick-choices">
                {GROUPS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    className={g.value === current.group ? `choice choice-${g.value} active` : `choice choice-${g.value}`}
                    onClick={() => decide(g.value)}
                    disabled={busy}
                  >
                    <kbd>{g.key}</kbd>
                    {g.name}
                  </button>
                ))}
              </div>

              {error && <p className="panel-error">Không lưu được: {error}</p>}

              <div className="quick-nav">
                <button type="button" className="btn btn-small" onClick={() => go(-1)} disabled={index === 0}>
                  ‹ Trước
                </button>
                <button type="button" className="btn btn-small" onClick={() => go(1)} title="S">
                  Bỏ qua ›
                </button>
                <button type="button" className="btn btn-small" onClick={undo} disabled={busy || history.length === 0} title="Z">
                  Hoàn tác
                </button>
              </div>

              <details className="shortcuts">
                <summary>Phím tắt</summary>
                <dl>
                  <dt>1 / 2</dt>
                  <dd>Có / Không có người sử dụng, lưu và sang video kế tiếp</dd>
                  <dt>S</dt>
                  <dd>Bỏ qua video này</dd>
                  <dt>Z</dt>
                  <dd>Hoàn tác video vừa phân loại</dd>
                  <dt>Space</dt>
                  <dd>Phát / dừng</dd>
                  <dt>← →</dt>
                  <dd>Tua lùi / tới {SEEK_STEP} giây</dd>
                  <dt>Esc</dt>
                  <dd>Đóng</dd>
                </dl>
              </details>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
