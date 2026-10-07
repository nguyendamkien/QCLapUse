import { Link } from "react-router-dom";
import FolderIcon from "./FolderIcon.jsx";
import ProjectNameForm from "./ProjectNameForm.jsx";

const dateFormat = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });

function formatSize(bytes) {
  if (!bytes) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function formatTotalDuration(seconds) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h) return `${h} giờ ${m} phút`;
  return m ? `${m} phút ${s} giây` : `${s} giây`;
}

function stats(videos) {
  return {
    count: videos.length,
    size: videos.reduce((sum, u) => sum + (u.size ?? 0), 0),
    duration: videos.reduce((sum, u) => sum + (u.duration ?? 0), 0),
  };
}

// Trang đầu của Tải dữ liệu: bảng tất cả folder project cùng số liệu. Bấm một dòng để mở project đó.
// Kéo file từ máy thả vào một dòng thì tải lên project đó.
// videosOf(projectId): video đã lưu của project (null = video chưa có project).
// Mỗi project có nút Gán nhãn / Đổi tên / Xoá ở cuối dòng; đổi tên sửa ngay tại ô tên.
export default function ProjectOverview({
  projects,
  videosOf,
  onOpen,
  onFileDrop,
  renamingId,
  onStartRename,
  onRename,
  onCancelRename,
  onDelete,
}) {
  const loose = videosOf(null);
  const rows = [
    ...projects.map((p) => ({ key: p.id, project: p, name: p.name, created: p.created_at, videos: videosOf(p.id) })),
    ...(loose.length > 0 ? [{ key: null, project: null, name: "Chưa có project", created: null, videos: loose }] : []),
  ];

  return (
    <div className="card project-overview">
      <table className="overview-table">
        <thead>
          <tr>
            <th>Project</th>
            <th className="num">Video</th>
            <th className="num">Thời lượng</th>
            <th className="num">Dung lượng</th>
            <th className="num">Ngày tạo</th>
            <th aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const s = stats(row.videos);
            return (
              <tr
                key={row.key ?? "loose"}
                className={row.project ? "overview-row" : "overview-row overview-loose"}
                onClick={() => onOpen(row.key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onFileDrop(e, row.key)}
              >
                <td>
                  {row.project && renamingId === row.project.id ? (
                    <ProjectNameForm
                      initial={row.project.name}
                      submitLabel="Lưu"
                      onSubmit={(name) => onRename(row.project, name)}
                      onCancel={onCancelRename}
                    />
                  ) : (
                    // Nút để mở bằng bàn phím; cả dòng cũng bấm được
                    <button
                      type="button"
                      className="overview-name"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(row.key);
                      }}
                    >
                      <FolderIcon size={22} />
                      <span>{row.name}</span>
                    </button>
                  )}
                </td>
                <td className="num strong">{s.count}</td>
                <td className="num muted">{formatTotalDuration(s.duration)}</td>
                <td className="num muted">{formatSize(s.size)}</td>
                <td className="num muted">{row.created ? dateFormat.format(new Date(row.created)) : "—"}</td>
                <td>
                  {row.project && (
                    <span className="overview-actions" onClick={(e) => e.stopPropagation()}>
                      <Link className="btn btn-small" to={`/labeling?project=${row.project.id}`}>
                        Gán nhãn
                      </Link>
                      <button type="button" className="btn btn-small" onClick={() => onStartRename(row.project.id)}>
                        Đổi tên
                      </button>
                      <button type="button" className="btn btn-small btn-danger" onClick={() => onDelete(row.project)}>
                        Xoá
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
