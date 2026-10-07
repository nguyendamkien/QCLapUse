import { useState } from "react";
import { GROUPS } from "../../classification/constants.js";

const COLLAPSED_KEY = "labeling.collapsedFolders";
const FILTER_KEY = "labeling.statusFilter";

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Trình duyệt chặn localStorage thì chỉ không nhớ được lựa chọn
  }
}

function formatDuration(seconds) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Folder giống phần phân loại: Chưa phân loại, rồi từng nhóm
function buildTree(uploads) {
  return [
    { key: "unclassified", label: "Chưa phân loại", videos: uploads.filter((u) => !u.group) },
    ...GROUPS.map((g) => ({ key: g.value, label: g.name, videos: uploads.filter((u) => u.group === g.value) })),
  ];
}

export const LABEL_STATUS = {
  todo: { label: "Chưa label", className: "progress-todo" },
  doing: { label: "Đang label", className: "progress-doing" },
  review: { label: "✨ Chờ xác nhận", className: "progress-review" },
  done: { label: "Hoàn thành · có event", className: "progress-done" },
  empty: { label: "Hoàn thành · không có event", className: "progress-skip" },
};

// Video nào cũng gán nhãn được (phòng khi phân loại nhầm), không phụ thuộc nhóm.
// Còn người do auto label đề xuất chưa được chấp nhận thì là chờ xác nhận. Người gán bấm Enter
// đánh dấu xong: có event thì ô tick xanh, không có event thì ô xám gạch ngang.
// Chưa đánh dấu xong: chưa có event là chưa label, đã có event là đang label.
export function labelStatus(item, summary) {
  if (summary?.auto_pending > 0) return "review";
  if (summary?.done) return summary.track_count ? "done" : "empty";
  return summary?.track_count ? "doing" : "todo";
}

const isComplete = (status) => status === "done" || status === "empty";

const PROGRESS_FILTERS = [
  { value: "complete", label: "Đã hoàn thành", match: (status) => isComplete(status) },
  { value: "incomplete", label: "Chưa hoàn thành", match: (status) => !isComplete(status) },
];

function readFilter() {
  const saved = readJson(FILTER_KEY, null);
  const values = Array.isArray(saved) ? saved.filter((v) => PROGRESS_FILTERS.some((f) => f.value === v)) : null;
  return new Set(values ?? PROGRESS_FILTERS.map((f) => f.value));
}

function VideoItem({ item, summary, active, onSelect }) {
  const statusKey = labelStatus(item, summary);
  const status = LABEL_STATUS[statusKey];
  const people = summary?.track_count ? ` · ${summary.track_count} người` : "";

  return (
    <li>
      <button type="button" className={active ? "video-item active" : "video-item"} onClick={() => onSelect(item.id)}>
        <span className="video-item-row">
          {/* Ô tiến độ: trống = chưa label, nửa = đang label,
              tick xanh = hoàn thành có event, ô xám gạch ngang = hoàn thành không có event */}
          <span className={`progress-box ${status.className}`} role="img" aria-label={status.label} title={status.label} />
          <span className="video-item-text">
            <span className="video-item-name" title={item.name}>
              {item.name}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

export default function VideoTree({ uploads, summaries, activeId, onSelect }) {
  const [collapsed, setCollapsed] = useState(() => new Set(readJson(COLLAPSED_KEY, [])));
  const [filter, setFilter] = useState(readFilter);

  const statusOf = (u) => labelStatus(u, summaries[u.id]);
  const counts = Object.fromEntries(
    PROGRESS_FILTERS.map((f) => [f.value, uploads.filter((u) => f.match(statusOf(u))).length])
  );
  const filtered = uploads.filter((u) =>
    PROGRESS_FILTERS.some((f) => filter.has(f.value) && f.match(statusOf(u)))
  );
  const filtering = filter.size < PROGRESS_FILTERS.length;

  const toggleFilter = (value) =>
    setFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      writeJson(FILTER_KEY, [...next]);
      return next;
    });

  const toggle = (key) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeJson(COLLAPSED_KEY, [...next]);
      return next;
    });

  const renderVideos = (videos) => (
    <ul className="video-list-group">
      {videos.map((item) => (
        <VideoItem
          key={item.id}
          item={item}
          summary={summaries[item.id]}
          active={item.id === activeId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );

  const header = (key, label, count) => (
    <button
      type="button"
      className="tree-folder"
      onClick={() => toggle(key)}
      aria-expanded={!collapsed.has(key)}
    >
      <span className="tree-caret">{collapsed.has(key) ? "▸" : "▾"}</span>
      <span className="tree-label">{label}</span>
      <span className="tree-count">{count}</span>
    </button>
  );

  return (
    <>
      <fieldset className="status-checklist">
        <legend className="visually-hidden">Lọc theo tiến độ gán nhãn</legend>
        {PROGRESS_FILTERS.map((f) => (
          <label key={f.value} className="status-check">
            <input type="checkbox" checked={filter.has(f.value)} onChange={() => toggleFilter(f.value)} />
            <span>{f.label}</span>
            <span className="status-check-count">{counts[f.value]}</span>
          </label>
        ))}
      </fieldset>
      <div className="video-list">
        {filtered.length === 0 && (
          <p className="panel-empty">Không có video nào khớp với ô đã tick.</p>
        )}
        {buildTree(filtered).map((folder) => {
          // Đang lọc thì ẩn folder không có video cho gọn
          if (filtering && folder.videos.length === 0) return null;
          return (
            <section key={folder.key} className="tree-section">
              {header(folder.key, folder.label, folder.videos.length)}
              {!collapsed.has(folder.key) && folder.videos.length > 0 && renderVideos(folder.videos)}
            </section>
          );
        })}
      </div>
    </>
  );
}
