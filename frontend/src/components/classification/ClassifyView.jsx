import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { classifyUploads, deleteUpload, moveToProject, videoUrl } from "../../api/client.js";
import QuickClassifier from "./QuickClassifier.jsx";
import {
  CLASSIFY_FOLDERS as FOLDERS,
  UPLOAD_DRAG_TYPE as DRAG_TYPE,
  findClassifyFolder,
  groupName,
} from "../../classification/constants.js";
import "./ClassifyView.css";

function formatDuration(seconds) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Phân loại video của một project (nằm trong trang Tải dữ liệu, khi mở một folder project).
// uploads: video của project này. folderKey: folder phân loại đang mở, chọn ở cây project bên trái.
// onUpdated nhận các bản ghi đã đổi, onDeleted nhận id đã xoá.
export default function ClassifyView({ uploads, projects, projectId, folderKey, onUpdated, onDeleted, onError }) {
  const folder = findClassifyFolder(folderKey);

  const [selected, setSelected] = useState(() => new Set());
  const [lastClicked, setLastClicked] = useState(null);
  const [quick, setQuick] = useState(null);

  useEffect(() => {
    setSelected(new Set());
    setLastClicked(null);
  }, [folder.key]);

  const uploadsById = useMemo(() => new Map(uploads.map((u) => [u.id, u])), [uploads]);

  const visible = useMemo(() => uploads.filter(folder.match), [uploads, folder]);

  const selectedIds = visible.filter((u) => selected.has(u.id)).map((u) => u.id);

  const mergeUpdated = onUpdated;

  // Dùng trong chế độ phân loại nhanh: ném lỗi để màn hình đó tự hiển thị
  const classify = async (ids, group) => mergeUpdated(await classifyUploads(ids, group));

  const moveTo = async (ids, target) => {
    try {
      await classify(ids, target.group);
      setSelected(new Set());
    } catch (error) {
      onError(`Không chuyển được video: ${error.message}`);
    }
  };

  const moveSelectedToProject = async (targetProjectId) => {
    try {
      mergeUpdated(await moveToProject(selectedIds, targetProjectId === "none" ? null : targetProjectId));
      setSelected(new Set());
    } catch (error) {
      onError(`Không chuyển được video sang project khác: ${error.message}`);
    }
  };

  const deleteSelected = async () => {
    if (!window.confirm(`Xoá ${selectedIds.length} video đã chọn? Nhãn đi kèm cũng bị xoá.`)) return;
    const deleted = [];
    for (const id of selectedIds) {
      try {
        await deleteUpload(id);
        deleted.push(id);
      } catch (error) {
        onError(`Không xoá được "${uploadsById.get(id)?.name}": ${error.message}`);
      }
    }
    onDeleted(deleted);
    setSelected(new Set());
  };

  const toggleSelect = (id, event) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (event.shiftKey && lastClicked) {
        // Shift + click chọn cả dải từ video bấm trước tới video này
        const ids = visible.map((u) => u.id);
        const [a, b] = [ids.indexOf(lastClicked), ids.indexOf(id)].sort((x, y) => x - y);
        if (a >= 0) ids.slice(a, b + 1).forEach((i) => next.add(i));
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastClicked(id);
  };

  const selectAll = () =>
    setSelected(selectedIds.length === visible.length ? new Set() : new Set(visible.map((u) => u.id)));

  const startDrag = (event, id) => {
    const ids = selected.has(id) ? selectedIds : [id];
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    event.dataTransfer.effectAllowed = "move";
  };

  const openQuick = (startId) => {
    const ids = visible.map((u) => u.id);
    if (ids.length === 0) return;
    setQuick({ ids, start: startId ? Math.max(0, ids.indexOf(startId)) : 0 });
  };

  return (
    <div className="classify-view">
      <div className="card classify-main">
        <div className="classify-toolbar">
          <div className="classify-folder-title">
            {folder.label}
            <span className="classify-count">{visible.length}</span>
          </div>

          <Link className="btn btn-outline classify-label-link" to={`/labeling?project=${projectId}`}>
            Gán nhãn
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openQuick()}
            disabled={visible.length === 0}
          >
            ▶ {folder.key === "unclassified" ? "Phân loại nhanh" : "Xem nhanh"} ({visible.length})
          </button>
        </div>

        {visible.length > 0 && (
          <div className="classify-actions">
            <label className="select-all">
              <input
                type="checkbox"
                checked={selectedIds.length > 0 && selectedIds.length === visible.length}
                onChange={selectAll}
              />
              {selectedIds.length > 0 ? `Đã chọn ${selectedIds.length}` : "Chọn tất cả"}
            </label>
            {selectedIds.length > 0 && (
              <>
                <select
                  className="classify-select"
                  value=""
                  onChange={(e) => {
                    const target = FOLDERS.find((f) => f.key === e.target.value)?.target;
                    if (target) moveTo(selectedIds, target);
                  }}
                  aria-label="Chuyển video đã chọn tới folder"
                >
                  <option value="" disabled>
                    Chuyển tới...
                  </option>
                  {FOLDERS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select
                  className="classify-select"
                  value=""
                  onChange={(e) => moveSelectedToProject(e.target.value)}
                  aria-label="Chuyển video đã chọn sang project khác"
                >
                  <option value="" disabled>
                    Chuyển sang project...
                  </option>
                  {projects
                    .filter((p) => p.id !== projectId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  <option value="none">Bỏ khỏi project (để ở ngoài)</option>
                </select>
                <button type="button" className="btn btn-small btn-danger" onClick={deleteSelected}>
                  Xoá
                </button>
                <button type="button" className="btn btn-small" onClick={() => setSelected(new Set())}>
                  Bỏ chọn
                </button>
              </>
            )}
          </div>
        )}

        {visible.length === 0 ? (
          <p className="upload-empty">
            {folder.key === "unclassified" ? "Không còn video nào chờ phân loại." : "Folder này chưa có video."}
          </p>
        ) : (
          <ul className="video-grid">
            {visible.map((upload) => (
              <VideoCard
                key={upload.id}
                upload={upload}
                selected={selected.has(upload.id)}
                onToggle={(event) => toggleSelect(upload.id, event)}
                onOpen={() => openQuick(upload.id)}
                labelUrl={`/labeling?project=${projectId}&video=${upload.id}`}
                onDragStart={(event) => startDrag(event, upload.id)}
              />
            ))}
          </ul>
        )}
    </div>

      {quick && (
        <QuickClassifier
          ids={quick.ids}
          startIndex={quick.start}
          uploadsById={uploadsById}
          onClassify={classify}
          onClose={() => setQuick(null)}
        />
      )}
    </div>
  );
}

function VideoCard({ upload, selected, onToggle, onOpen, labelUrl, onDragStart }) {
  const videoRef = useRef(null);

  // Rê chuột vào thì phát không tiếng để xem nhanh, rời chuột thì về khung đầu
  const preview = (play) => {
    const video = videoRef.current;
    if (!video) return;
    if (play) {
      video.play().catch(() => {});
    } else {
      video.pause();
      video.currentTime = 0.5;
    }
  };

  return (
    <li
      className={selected ? "video-card selected" : "video-card"}
      draggable
      onDragStart={onDragStart}
      onClick={onToggle}
    >
      <div className="thumb" onMouseEnter={() => preview(true)} onMouseLeave={() => preview(false)}>
        <video ref={videoRef} src={`${videoUrl(upload.id)}#t=0.5`} preload="metadata" muted playsInline />
        <input type="checkbox" className="thumb-check" checked={selected} readOnly tabIndex={-1} />
        <span className="thumb-duration">{formatDuration(upload.duration)}</span>
        {upload.proxy_status === "processing" && <span className="thumb-overlay">Đang chuyển định dạng...</span>}
        {upload.proxy_status === "error" && <span className="thumb-overlay">Lỗi chuyển định dạng</span>}
      </div>
      <div className="video-card-body">
        <div className="video-card-name" title={upload.name}>
          {upload.name}
        </div>
        {/* Nhóm đã thể hiện qua folder đang mở; chỉ hiện gợi ý cho video chưa phân loại */}
        {!upload.group && upload.suggested_group && (
          <div className="video-card-badges">
            <span className="badge badge-outline" title="Đoán từ tên thư mục lúc tải lên">
              Gợi ý: {groupName(upload.suggested_group)}
            </span>
          </div>
        )}
        <div className="video-card-buttons">
          <button
            type="button"
            className="btn btn-small"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            ▶ Xem
          </button>
          {/* Mở thẳng video này ở trang Gán nhãn */}
          <Link className="btn btn-small" to={labelUrl} onClick={(event) => event.stopPropagation()}>
            Gán nhãn
          </Link>
        </div>
      </div>
    </li>
  );
}
