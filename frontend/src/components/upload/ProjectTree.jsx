import { useState } from "react";
import { CLASSIFY_FOLDERS, UPLOAD_DRAG_TYPE } from "../../classification/constants.js";
import FolderIcon from "./FolderIcon.jsx";
import ProjectNameForm from "./ProjectNameForm.jsx";

const readDraggedIds = (event) => JSON.parse(event.dataTransfer.getData(UPLOAD_DRAG_TYPE) || "[]");
const isVideoDrag = (event) => event.dataTransfer.types.includes(UPLOAD_DRAG_TYPE);

// Cây project dọc bên trái trang Tải dữ liệu. Project đang mở được làm nổi bật và
// xổ ra các folder phân loại bên trong.
// - Kéo video (thẻ video bên phải) thả vào folder phân loại: gán nhóm; thả vào project khác: chuyển project.
// - Kéo file từ máy thả vào một project: tải lên project đó.
// Mỗi project có icon đổi tên / xoá ở cuối dòng; đổi tên sửa ngay tại dòng đó.
export default function ProjectTree({
  projects,
  openKey,
  openUploads,
  folderKey,
  countIn,
  looseCount,
  onBack,
  onOpenProject,
  onOpenFolder,
  onClassify,
  onMoveToProject,
  onFileDrop,
  renamingId,
  onStartRename,
  onRename,
  onCancelRename,
  onDelete,
}) {
  const [dropTarget, setDropTarget] = useState(null);
  // Bấm lại project đang mở thì thu gọn / mở lại các folder phân loại bên trong.
  // Lưu id project đã thu gọn để sang project khác thì tự mở ra.
  const [collapsedId, setCollapsedId] = useState(null);

  const clickProject = (projectId, open, expanded) => {
    if (open) {
      setCollapsedId(expanded ? projectId : null);
    } else {
      setCollapsedId(null);
      onOpenProject(projectId);
    }
  };

  const dropProps = (key, onVideos, onFiles) => ({
    onDragOver: (event) => {
      if (!onFiles && !isVideoDrag(event)) return;
      event.preventDefault();
      setDropTarget(key);
    },
    onDragLeave: (event) => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      setDropTarget((current) => (current === key ? null : current));
    },
    onDrop: (event) => {
      setDropTarget(null);
      if (isVideoDrag(event)) {
        event.preventDefault();
        event.stopPropagation();
        const ids = readDraggedIds(event);
        if (ids.length > 0) onVideos(ids);
      } else if (onFiles) {
        onFiles(event);
      }
    },
  });

  const rowClass = (key, active) =>
    ["tree-row", active ? "active" : "", dropTarget === key ? "drop-target" : ""].join(" ");

  return (
    <nav className="card project-tree" aria-label="Danh sách project">
      <button type="button" className="project-tree-back" onClick={onBack} title="Về bảng tất cả project">
        ← Tất cả project
      </button>

      {projects.length === 0 && looseCount === 0 && <p className="project-tree-empty">Chưa có project nào.</p>}

      <ul className="tree-list">
        {projects.map((project) => {
          const open = project.id === openKey;
          const expanded = open && collapsedId !== project.id;
          const key = `project:${project.id}`;
          return (
            <li key={project.id}>
              {renamingId === project.id ? (
                <div className="tree-rename">
                  <ProjectNameForm
                    initial={project.name}
                    submitLabel="Lưu"
                    onSubmit={(name) => onRename(project, name)}
                    onCancel={onCancelRename}
                  />
                </div>
              ) : (
                <div
                  className={rowClass(key, open) + " tree-project"}
                  {...dropProps(
                    key,
                    (ids) => !open && onMoveToProject(ids, project.id),
                    (event) => onFileDrop(event, project.id)
                  )}
                >
                  <button
                    type="button"
                    className="tree-open"
                    onClick={() => clickProject(project.id, open, expanded)}
                    aria-expanded={expanded}
                    title={project.name}
                  >
                    <span className="tree-caret" aria-hidden="true">
                      {expanded ? "▾" : "▸"}
                    </span>
                    <FolderIcon open={expanded} size={18} />
                    <span className="tree-label">{project.name}</span>
                    <span className="tree-count">{countIn(project.id)}</span>
                  </button>
                  <span className="tree-actions">
                    <button
                      type="button"
                      className="tree-icon"
                      onClick={() => onStartRename(project.id)}
                      title="Đổi tên"
                      aria-label={`Đổi tên project ${project.name}`}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      type="button"
                      className="tree-icon tree-icon-danger"
                      onClick={() => onDelete(project)}
                      title="Xoá project"
                      aria-label={`Xoá project ${project.name}`}
                    >
                      <TrashIcon />
                    </button>
                  </span>
                </div>
              )}

              {expanded && (
                <ul className="tree-list tree-children">
                  {CLASSIFY_FOLDERS.map((f) => {
                    const childKey = `folder:${f.key}`;
                    return (
                      <li key={f.key}>
                        <button
                          type="button"
                          className={rowClass(childKey, f.key === folderKey) + " tree-folder"}
                          onClick={() => onOpenFolder(f.key)}
                          {...dropProps(childKey, (ids) => onClassify(ids, f.target.group))}
                        >
                          <span className={`tree-dot tree-dot-${f.key}`} aria-hidden="true" />
                          <span className="tree-label">{f.label}</span>
                          <span className="tree-count">{openUploads.filter(f.match).length}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}

        {/* Video chưa thuộc project nào, giống file để ở thư mục gốc */}
        {looseCount > 0 && (
          <li>
            <button
              type="button"
              className={rowClass("loose", openKey === null) + " tree-project tree-loose"}
              aria-current={openKey === null ? "page" : undefined}
              onClick={() => onOpenProject(null)}
              {...dropProps(
                "loose",
                (ids) => openKey !== null && onMoveToProject(ids, null),
                (event) => onFileDrop(event, null)
              )}
            >
              <span className="tree-caret" aria-hidden="true" />
              <FolderIcon size={18} />
              <span className="tree-label">Chưa có project</span>
              <span className="tree-count">{looseCount}</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
