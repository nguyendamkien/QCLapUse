import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  classifyUploads,
  createProject,
  deleteProject,
  deleteUpload,
  listProjects,
  listUploads,
  moveToProject,
  renameProject,
  uploadVideo,
} from "../api/client.js";
import { CLASSIFY_FOLDERS, guessGroup } from "../classification/constants.js";
import ClassifyView from "../components/classification/ClassifyView.jsx";
import FolderIcon from "../components/upload/FolderIcon.jsx";
import ProjectNameForm from "../components/upload/ProjectNameForm.jsx";
import ProjectOverview from "../components/upload/ProjectOverview.jsx";
import ProjectTree from "../components/upload/ProjectTree.jsx";
import SaveLocationDialog from "../components/upload/SaveLocationDialog.jsx";
import "./UploadPage.css";

// Giữ khớp với ALLOWED_VIDEO_EXTENSIONS ở backend
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm"];

const STATUS = {
  uploading: { label: "Đang tải lên", className: "badge-warning" },
  ready: { label: "Sẵn sàng", className: "badge-success" },
  error: { label: "Lỗi", className: "badge-danger" },
};

// Video trình duyệt không phát được (ví dụ .avi) được chuyển sang MP4 để xem
const CONVERSION_STATUS = {
  processing: { label: "Đang chuyển định dạng", className: "badge-warning" },
  error: { label: "Lỗi chuyển định dạng", className: "badge-danger" },
};

const KIND_LABEL = { video: "Video", folder: "Thư mục", file: "File" };

// openKey khi đang mở mục "Chưa có project" (video chưa thuộc project nào)
const LOOSE_KEY = "loose";

let nextId = 0;
const newLocalId = () => `local-${Date.now()}-${nextId++}`;

function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

// Backend trả giờ UTC, hiển thị theo múi giờ của máy người dùng
const uploadTimeFormat = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatUploadTime(isoString) {
  return isoString ? uploadTimeFormat.format(new Date(isoString)) : "—";
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function describe(item) {
  if (item.kind === "folder") return `${item.fileCount.toLocaleString("vi-VN")} file`;
  return item.duration ? formatDuration(item.duration) : "—";
}

const isVideo = (file) => VIDEO_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));

const UNSUPPORTED_MESSAGE = `Hiện chỉ hỗ trợ tải video lên (${VIDEO_EXTENSIONS.join(", ")}).`;

// Tên thư mục trực tiếp chứa mỗi file kéo thả vào, dùng để gợi ý nhóm phân loại
const parentFolder = new WeakMap();

// Đọc đệ quy toàn bộ file trong một thư mục được kéo thả vào
async function collectFiles(entry) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const folder = entry.fullPath.split("/").slice(1, -1).at(-1);
    if (folder) parentFolder.set(file, folder);
    return [file];
  }
  const reader = entry.createReader();
  const children = [];
  let batch;
  do {
    batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    children.push(...batch);
  } while (batch.length > 0);
  const nested = await Promise.all(children.map(collectFiles));
  return nested.flat();
}

// File chọn bằng nút "Tải folder" có đường dẫn tương đối, ví dụ "kho/khong_dung/cam1.mp4".
// Trả tên thư mục gốc ("kho") và ghi lại thư mục cha của từng file để gợi ý nhóm.
function readPickedFolder(files) {
  for (const file of files) {
    const folder = file.webkitRelativePath.split("/").slice(0, -1).at(-1);
    if (folder) parentFolder.set(file, folder);
  }
  return files[0]?.webkitRelativePath.split("/")[0] || null;
}

// Chia file thành video cần tải lên và các dòng báo lỗi cho file không hỗ trợ
function planFiles(files, folderName, projectId = null) {
  const videos = files.filter(isVideo);
  const others = files.filter((f) => !isVideo(f));
  const errors = [];

  if (folderName && others.length > 0) {
    errors.push({
      id: newLocalId(),
      local: true,
      name: `${folderName}/`,
      kind: "folder",
      project_id: projectId,
      fileCount: others.length,
      size: others.reduce((sum, f) => sum + f.size, 0),
      status: "error",
      error: `Bỏ qua ${others.length} file không phải video trong thư mục. ${UNSUPPORTED_MESSAGE}`,
    });
  } else {
    for (const file of others) {
      errors.push({
        id: newLocalId(),
        local: true,
        name: file.name,
        kind: "file",
        project_id: projectId,
        size: file.size,
        status: "error",
        error: UNSUPPORTED_MESSAGE,
      });
    }
  }
  return { videos, errors };
}

export default function UploadPage() {
  const fileInput = useRef(null);
  const folderInput = useRef(null);
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [openErrorId, setOpenErrorId] = useState(null);
  const [projects, setProjects] = useState([]);
  // id của folder project đang mở, LOOSE_KEY nếu đang xem video chưa có project,
  // null nếu đang ở bảng tổng thể tất cả folder (mặc định khi vào trang).
  // ?project=<id> (nút "Mở" ở trang Tổng quan) mở thẳng project đó
  const [searchParams] = useSearchParams();
  const [openKey, setOpenKey] = useState(() => searchParams.get("project"));
  // Folder phân loại đang mở bên trong project đang mở (chọn ở cây project bên trái)
  const [classifyFolder, setClassifyFolder] = useState(CLASSIFY_FOLDERS[0].key);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  // Video vừa tải xong, chờ người dùng chọn nơi lưu trong hộp thoại.
  // projectId: folder đang đứng lúc tải, được chọn sẵn trong hộp thoại.
  // folderName: tên thư mục vừa tải lên (nếu có), gợi ý làm tên project mới
  const [justUploaded, setJustUploaded] = useState({ ids: [], projectId: null, folderName: null });

  useEffect(() => {
    listUploads()
      .then(setUploads)
      .catch((error) => setNotice(`Không tải được danh sách: ${error.message}`))
      .finally(() => setLoading(false));
    listProjects()
      .then((list) => {
        setProjects(list);
        // Project trong đường dẫn không còn thì về bảng tổng thể
        setOpenKey((prev) => (prev === LOOSE_KEY || list.some((p) => p.id === prev) ? prev : null));
      })
      .catch((error) => setNotice(`Không tải được danh sách project: ${error.message}`));
  }, []);

  // Video tải lên vào project đang mở; không mở project nào thì vào "Chưa có project"
  const targetProjectId = projects.some((p) => p.id === openKey) ? openKey : null;

  const openSection = (key) => {
    // Sang project khác thì bắt đầu lại từ folder "Chưa phân loại"
    if (key !== openKey) setClassifyFolder(CLASSIFY_FOLDERS[0].key);
    setOpenKey(key);
  };

  const handleCreateProject = async (name) => {
    const project = await createProject(name);
    setProjects((prev) => [...prev, project]);
    setCreating(false);
    openSection(project.id);
  };

  const handleRenameProject = async (project, name) => {
    const updated = await renameProject(project.id, name);
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setRenamingId(null);
  };

  const handleDeleteProject = async (project) => {
    const count = uploads.filter((u) => u.project_id === project.id && !u.local).length;
    const message = count
      ? `Xoá project "${project.name}" cùng ${count} video bên trong? Video và nhãn đã gán sẽ bị xoá vĩnh viễn, không hoàn tác được.`
      : `Xoá project "${project.name}"?`;
    if (!window.confirm(message)) return;
    try {
      await deleteProject(project.id);
    } catch (error) {
      setNotice(`Không xoá được project: ${error.message}`);
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== project.id));
    setUploads((prev) => prev.filter((u) => u.project_id !== project.id));
    if (openKey === project.id) openSection(null);
  };

  // Kéo video thả vào folder phân loại ở cây project
  const handleClassifyIds = async (ids, group) => {
    try {
      mergeUpdated(await classifyUploads(ids, group));
    } catch (error) {
      setNotice(`Không chuyển được video: ${error.message}`);
    }
  };

  // Kéo video thả vào một project khác (hoặc "Chưa có project") ở cây project
  const handleMoveIds = async (ids, projectId) => {
    try {
      mergeUpdated(await moveToProject(ids, projectId));
    } catch (error) {
      setNotice(`Không chuyển được video sang project khác: ${error.message}`);
    }
  };

  const handleMove = async (item, projectId) => {
    try {
      const [saved] = await moveToProject([item.id], projectId);
      setUploads((prev) => prev.map((u) => (u.id === saved.id ? saved : u)));
    } catch (error) {
      setNotice(`Không chuyển được "${item.name}": ${error.message}`);
    }
  };

  // Có video đang chuyển định dạng thì hỏi lại máy chủ định kỳ cho tới khi xong
  const converting = uploads.some((u) => u.proxy_status === "processing");
  useEffect(() => {
    if (!converting) return;
    const timer = setInterval(() => {
      listUploads()
        .then((list) => {
          const byId = new Map(list.map((u) => [u.id, u]));
          setUploads((prev) => prev.map((u) => byId.get(u.id) ?? u));
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [converting]);

  const updateItem = (id, changes) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...changes } : u)));

  // Tải lần lượt từng video để không nghẽn băng thông và dễ theo dõi tiến độ
  const startUploads = async ({ videos, errors }, projectId, folderName = null) => {
    if (videos.length === 0 && errors.length === 0) return;
    // Mở folder nhận video để thấy tiến độ tải lên
    if (projectId) openSection(projectId);
    const queued = videos.map((file) => ({
      file,
      item: {
        id: newLocalId(),
        local: true,
        name: file.name,
        kind: "video",
        // Nút đã bắt đầu lượt tải này, để tiến độ hiện đúng trên nút đó
        source: folderName ? "folder" : "files",
        project_id: projectId,
        size: file.size,
        status: "uploading",
        progress: 0,
      },
    }));
    setUploads((prev) => [...queued.map((q) => q.item), ...errors, ...prev]);

    for (const { file, item } of queued) {
      try {
        const saved = await uploadVideo(file, (progress) => updateItem(item.id, { progress }), {
          suggestedGroup: guessGroup(parentFolder.get(file)),
          projectId,
        });
        setUploads((prev) => prev.map((u) => (u.id === item.id ? saved : u)));
        // Ghi nhận ngay để video xong trước vẫn ẩn trong lúc các video khác còn đang tải
        setJustUploaded((prev) => ({
          ids: [...prev.ids, saved.id],
          projectId,
          folderName: folderName ?? prev.folderName,
        }));
      } catch (error) {
        updateItem(item.id, { status: "error", error: error.message });
      }
    }
  };

  const closeSaveDialog = () => setJustUploaded({ ids: [], projectId: null, folderName: null });

  const assignJustUploaded = async (ids, projectId) => {
    const saved = await moveToProject(ids, projectId);
    const byId = new Map(saved.map((u) => [u.id, u]));
    setUploads((prev) => prev.map((u) => byId.get(u.id) ?? u));
    closeSaveDialog();
    openSection(projectId);
  };

  const handleCreateAndAssign = async (ids, name) => {
    const project = await createProject(name);
    setProjects((prev) => [...prev, project]);
    await assignJustUploaded(ids, project.id);
  };

  // Kéo thả vẫn dùng được: thả lên một project thì vào project đó, thả chỗ khác thì vào project đang mở
  const handleDrop = async (event, projectId) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);

    const entries = [...event.dataTransfer.items]
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean);

    if (entries.length === 0) {
      startUploads(planFiles([...event.dataTransfer.files], null, projectId), projectId);
      return;
    }

    const plans = await Promise.all(
      entries.map(async (entry) =>
        planFiles(await collectFiles(entry), entry.isDirectory ? entry.name : null, projectId)
      )
    );
    startUploads(
      { videos: plans.flatMap((p) => p.videos), errors: plans.flatMap((p) => p.errors) },
      projectId,
      entries.find((entry) => entry.isDirectory)?.name ?? null
    );
  };

  const handleDelete = async (item) => {
    if (!item.local) {
      try {
        await deleteUpload(item.id);
      } catch (error) {
        setNotice(`Không xoá được "${item.name}": ${error.message}`);
        return;
      }
    }
    setUploads((prev) => prev.filter((u) => u.id !== item.id));
    if (openErrorId === item.id) setOpenErrorId(null);
  };

  const renderVideos = (videos) => (
    <div className="upload-table-wrap">
      <table className="upload-table">
        <tbody>
          {videos.map((item) => (
            <UploadRow
              key={item.id}
              item={item}
              projects={projects}
              onMove={(projectId) => handleMove(item, projectId)}
              errorOpen={openErrorId === item.id}
              onToggleError={() => setOpenErrorId(openErrorId === item.id ? null : item.id)}
              onDelete={() => handleDelete(item)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );

  // Video vừa tải có thể đã bị xoá trong lúc hộp thoại đang mở
  const pendingIds = justUploaded.ids.filter((id) => uploads.some((u) => u.id === id));

  // Video đang tải, hoặc đã tải xong nhưng đang chờ chọn nơi lưu trong hộp thoại, chưa hiện
  // trong danh sách. Tiến độ tải hiện trên nút "Tải video"
  const uploading = uploads.filter((u) => u.status === "uploading");
  const shown = uploads.filter((u) => u.status !== "uploading" && !pendingIds.includes(u.id));
  const progressLabel = (source, idle) => {
    const items = uploading.filter((u) => u.source === source);
    if (items.length === 0) return idle;
    const progress = items.find((u) => u.progress > 0)?.progress ?? 0;
    return `Đang tải... còn ${items.length} video · ${progress}%`;
  };

  // Video chưa thuộc project nào nằm ngoài các folder, giống file để ở thư mục gốc
  const looseVideos = shown.filter((u) => !u.project_id);
  const openProject = projects.find((p) => p.id === openKey) ?? null;
  // Đang xem video chưa có project (hết video thì về bảng tổng thể)
  const openLoose = openKey === LOOSE_KEY && looseVideos.length > 0;
  // Chỉ đếm video đã lưu trên máy chủ, không đếm dòng báo lỗi tải lên
  const inProject = (projectId) => shown.filter((u) => u.project_id === projectId && !u.local);
  const countIn = (projectId) => inProject(projectId).length;

  const mergeUpdated = (updated) => {
    const byId = new Map(updated.map((u) => [u.id, u]));
    setUploads((prev) => prev.map((u) => byId.get(u.id) ?? u));
  };

  const removeDeleted = (ids) => setUploads((prev) => prev.filter((u) => !ids.includes(u.id)));

  return (
    <section
      className={dragging ? "upload-page dragging" : "upload-page"}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => handleDrop(e, targetProjectId)}
    >
      <h1 className="page-title">Tải dữ liệu</h1>

      <div className="upload-actions">
        <button type="button" className="btn btn-outline" onClick={() => setCreating(true)} disabled={creating}>
          + Tạo project
        </button>
        <button type="button" className="btn btn-primary" onClick={() => fileInput.current.click()}>
          {progressLabel("files", "Tải video")}
        </button>
        <button type="button" className="btn btn-outline" onClick={() => folderInput.current.click()}>
          {progressLabel("folder", "Tải folder")}
        </button>
        <input
          ref={folderInput}
          type="file"
          webkitdirectory=""
          multiple
          hidden
          onChange={(e) => {
            const files = [...e.target.files];
            const folderName = readPickedFolder(files);
            startUploads(planFiles(files, folderName, targetProjectId), targetProjectId, folderName);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept={VIDEO_EXTENSIONS.join(",")}
          multiple
          hidden
          onChange={(e) => {
            startUploads(planFiles([...e.target.files], null, targetProjectId), targetProjectId);
            e.target.value = "";
          }}
        />
      </div>

      {/* Hộp thoại chọn nơi lưu mở khi đã tải xong hết các video đang tải */}
      {pendingIds.length > 0 && uploading.length === 0 && (
        <SaveLocationDialog
          count={pendingIds.length}
          projects={projects}
          initial={justUploaded.projectId}
          folderName={justUploaded.folderName}
          onSave={(projectId) => assignJustUploaded(pendingIds, projectId)}
          onCreateAndSave={(name) => handleCreateAndAssign(pendingIds, name)}
          onClose={closeSaveDialog}
        />
      )}

      {creating && (
        <div className="card project-create">
          <ProjectNameForm submitLabel="Tạo" onSubmit={handleCreateProject} onCancel={() => setCreating(false)} />
        </div>
      )}

      {notice && (
        <p className="upload-notice" role="alert">
          {notice}
          <button type="button" className="btn btn-small" onClick={() => setNotice("")}>
            Đóng
          </button>
        </p>
      )}

      {loading ? (
        <p className="upload-empty">Đang tải danh sách...</p>
      ) : !openProject && !openLoose ? (
        // Mới vào trang: bảng tổng thể tất cả folder, bấm một folder để mở
        projects.length === 0 && looseVideos.length === 0 ? (
          <p className="card upload-empty">Chưa có project nào. Bấm "+ Tạo project" rồi tải video vào project.</p>
        ) : (
          <ProjectOverview
            projects={projects}
            videosOf={(projectId) => (projectId ? inProject(projectId) : looseVideos.filter((u) => !u.local))}
            onOpen={(projectId) => openSection(projectId ?? LOOSE_KEY)}
            onFileDrop={handleDrop}
            renamingId={renamingId}
            onStartRename={setRenamingId}
            onRename={handleRenameProject}
            onCancelRename={() => setRenamingId(null)}
            onDelete={handleDeleteProject}
          />
        )
      ) : (
        <div className="upload-layout">
          <ProjectTree
            projects={projects}
            openKey={openProject ? openProject.id : null}
            openUploads={openProject ? inProject(openProject.id) : []}
            folderKey={classifyFolder}
            countIn={countIn}
            looseCount={looseVideos.length}
            onBack={() => openSection(null)}
            onOpenProject={(projectId) => openSection(projectId ?? LOOSE_KEY)}
            onOpenFolder={setClassifyFolder}
            onClassify={handleClassifyIds}
            onMoveToProject={handleMoveIds}
            onFileDrop={handleDrop}
            renamingId={renamingId}
            onStartRename={setRenamingId}
            onRename={handleRenameProject}
            onCancelRename={() => setRenamingId(null)}
            onDelete={handleDeleteProject}
          />

          <div className="upload-main">
            {openProject ? (
              // Đang mở một project: video của folder phân loại đang chọn
              <>
                {/* Video tải lỗi vào project này: chỉ có ở trình duyệt, không có trên máy chủ */}
                {shown.some((u) => u.project_id === openProject.id && u.local) && (
                  <div className="card project-list">
                    {renderVideos(shown.filter((u) => u.project_id === openProject.id && u.local))}
                  </div>
                )}
                {countIn(openProject.id) === 0 && (
                  <p className="card upload-empty">Project trống. Bấm "Tải video" hoặc kéo thả video vào đây.</p>
                )}
                {countIn(openProject.id) > 0 && (
                  // key: đổi project thì dựng lại, không giữ video đã chọn của project trước
                  <ClassifyView
                    key={openProject.id}
                    uploads={inProject(openProject.id)}
                    projects={projects}
                    projectId={openProject.id}
                    folderKey={classifyFolder}
                    onUpdated={mergeUpdated}
                    onDeleted={removeDeleted}
                    onError={setNotice}
                  />
                )}
              </>
            ) : (
              <div className="card project-list" onDrop={(e) => handleDrop(e, null)}>
                <div className="folder-bar">
                  <FolderIcon open size={20} />
                  <span className="project-title">Chưa có project</span>
                  <span className="project-count">{looseVideos.length} video</span>
                </div>
                {renderVideos(looseVideos)}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function UploadRow({ item, projects, onMove, errorOpen, onToggleError, onDelete }) {
  const status = CONVERSION_STATUS[item.proxy_status] ?? STATUS[item.status];
  const label = item.status === "uploading" ? `${status.label} - ${item.progress}%` : status.label;

  return (
    <>
      <tr>
        <td className="cell-name">{item.name}</td>
        <td>
          {/* Video chưa lưu xong trên máy chủ thì chưa đổi project được */}
          {!item.local && (
            <select
              className="project-select"
              value={item.project_id ?? ""}
              onChange={(e) => onMove(e.target.value || null)}
              aria-label={`Project của ${item.name}`}
            >
              <option value="">Chưa có project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </td>
        <td className="cell-muted">{KIND_LABEL[item.kind]}</td>
        <td className="cell-mono">{describe(item)}</td>
        <td className="cell-mono">{item.size ? formatSize(item.size) : "—"}</td>
        <td className="cell-mono" title="Thời gian tải lên">{formatUploadTime(item.created_at)}</td>
        <td>
          <span className={`badge ${status.className}`}>{label}</span>
        </td>
        <td>
          <div className="cell-actions">
            {item.status === "error" && (
              <button type="button" className="btn btn-small" onClick={onToggleError}>
                {errorOpen ? "Ẩn lỗi" : "Xem lỗi"}
              </button>
            )}
            {item.status !== "uploading" && (
              <button type="button" className="btn btn-small btn-danger" onClick={onDelete}>
                Xóa
              </button>
            )}
          </div>
        </td>
      </tr>
      {errorOpen && (
        <tr className="error-row">
          <td colSpan={8}>{item.error}</td>
        </tr>
      )}
    </>
  );
}
