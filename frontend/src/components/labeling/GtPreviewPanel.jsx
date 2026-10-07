import { useEffect, useState } from "react";
import { getGtPreview } from "../../api/client.js";
import { groupName } from "../../classification/constants.js";

const FRAME_STEPS = [1, 2, 5, 10, 25];

// JSON thụt lề nhưng giữ mỗi bbox trên một dòng cho dễ đọc
const prettyJson = (value) =>
  JSON.stringify(value, null, 2).replace(/\[\s+([-\d.e,\s]+?)\s+\]/g, (_, nums) => `[${nums.split(/,\s*/).join(", ")}]`);

function downloadJson(value, fileName) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * GT của video đang gán, dựng từ nhãn đã lưu theo đúng định dạng file GT.
 * Tự tải lại sau mỗi lần lưu nhãn.
 */
export default function GtPreviewPanel({ videoId, savedAt, unsaved, onSeek, onClose }) {
  const [frameStep, setFrameStep] = useState(5);
  const [tab, setTab] = useState("summary");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGtPreview(videoId, frameStep)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setError(err.message);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [videoId, frameStep, savedAt]);

  const video = preview?.video;
  const frames = video ? Object.keys(video.frames).map(Number) : [];
  const boxCount = video ? Object.values(video.frames).reduce((sum, boxes) => sum + boxes.length, 0) : 0;
  const evalFrames = video ? Math.ceil(video.total_frames / frameStep) : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(video, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Trình duyệt không cho sao chép, hãy dùng nút Tải JSON.");
    }
  };

  const frameButton = (frame) => (
    <button type="button" className="gt-frame-link" onClick={() => onSeek(frame)} title="Tua tới frame này">
      {frame}
    </button>
  );

  return (
    <aside className="gt-drawer" aria-label="GT của video">
      <div className="gt-drawer-header">
        <strong>GT của video</strong>
        <span className="gt-drawer-sub">xem trước, chưa khoá</span>
        <button type="button" className="btn btn-small" onClick={onClose}>
          Đóng
        </button>
      </div>

      <div className="gt-drawer-toolbar">
        <div className="gt-tabs" role="tablist">
          {[
            ["summary", "Tóm tắt"],
            ["json", "JSON"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "gt-tab active" : "gt-tab"}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          className="classify-select"
          value={frameStep}
          onChange={(e) => setFrameStep(Number(e.target.value))}
          aria-label="Chấm mỗi bao nhiêu frame"
        >
          {FRAME_STEPS.map((step) => (
            <option key={step} value={step}>
              {step === 1 ? "Chấm mọi frame" : `Chấm mỗi ${step} frame`}
            </option>
          ))}
        </select>
      </div>

      {unsaved && <p className="gt-drawer-note">Có thay đổi chưa lưu. GT sẽ cập nhật sau khi lưu.</p>}

      <div className="gt-drawer-body">
        {error ? (
          <p className="panel-error">{error}</p>
        ) : !video ? (
          <p className="panel-empty">{loading ? "Đang dựng GT..." : ""}</p>
        ) : tab === "json" ? (
          <>
            <div className="gt-json-actions">
              <button type="button" className="btn btn-small" onClick={copy}>
                {copied ? "✓ Đã sao chép" : "Sao chép"}
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => downloadJson(video, `gt_${video.name.replace(/\.[^.]+$/, "")}.json`)}
              >
                ⬇ Tải JSON
              </button>
            </div>
            <pre className="gt-json">{prettyJson(video)}</pre>
          </>
        ) : (
          <>
            <div className="gt-status">
              <span className={preview.eligible ? "badge badge-success" : "badge badge-danger"}>
                {preview.eligible ? "Đủ điều kiện vào GT" : "Chưa đủ điều kiện"}
              </span>
              <span className="cell-muted">{groupName(video.group)}</span>
            </div>
            {preview.issues.length > 0 && (
              <ul className="gt-issues">
                {preview.issues.map((issue, i) => (
                  <li key={i} className={`issue-${issue.level}`}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}

            <dl className="gt-summary">
              <dt>Tổng số frame</dt>
              <dd>{video.total_frames}</dd>
              <dt>Frame được chấm</dt>
              <dd>{evalFrames}</dd>
              <dt>Frame có box</dt>
              <dd>{frames.length}</dd>
              <dt>Số box</dt>
              <dd>{boxCount}</dd>
              <dt>Frame negative</dt>
              <dd>{evalFrames - frames.length}</dd>
            </dl>

            {video.group === "not_using" ? (
              <p className="gt-drawer-note">
                Video không có người sử dụng: mọi frame được chấm đều là negative, không có box.
              </p>
            ) : (
              <>
                <div className="gt-section-title">Sự kiện (events) · {video.events.length}</div>
                {video.events.length === 0 ? (
                  <p className="panel-empty">Chưa có sự kiện nào.</p>
                ) : (
                  <ul className="gt-ranges">
                    {video.events.map((e, i) => (
                      <li key={i}>
                        Người #{e.track_id}: frame {frameButton(e.start)} – {frameButton(e.end)}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="gt-section-title">Không chấm (ignore) · {video.ignore.length}</div>
                {video.ignore.length === 0 ? (
                  <p className="panel-empty">Không có. Mọi đoạn đều có box ở hai đầu.</p>
                ) : (
                  <ul className="gt-ranges">
                    {video.ignore.map((r, i) => (
                      <li key={i}>
                        Người #{r.track_id}: frame {frameButton(r.start)} – {frameButton(r.end)}
                        <span className="cell-muted"> · {r.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="gt-section-title">Frame có box · {frames.length}</div>
                {frames.length === 0 ? (
                  <p className="panel-empty">Chưa có frame được chấm nào có box.</p>
                ) : (
                  <div className="gt-frame-list">
                    {frames.map((frame) => (
                      <button
                        key={frame}
                        type="button"
                        className={
                          video.frames[frame].some((b) => b.source === "keyframe")
                            ? "gt-frame-chip keyframe"
                            : "gt-frame-chip"
                        }
                        onClick={() => onSeek(frame)}
                        title={`${video.frames[frame].length} box`}
                      >
                        {frame}
                      </button>
                    ))}
                  </div>
                )}
                <p className="gt-field-help">Frame in đậm có box vẽ tay, còn lại là box nội suy.</p>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
