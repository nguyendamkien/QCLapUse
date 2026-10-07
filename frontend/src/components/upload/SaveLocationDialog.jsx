import { useEffect, useState } from "react";
import FolderIcon from "./FolderIcon.jsx";

const NEW_PROJECT = "__new__";

// Chọn sẵn: folder đang đứng lúc tải; tải cả thư mục thì project trùng tên thư mục,
// chưa có thì "Tạo project mới" với tên thư mục; còn lại là project đầu tiên
function initialChoice(projects, initial, folderName) {
  if (initial) return initial;
  if (folderName) {
    const key = folderName.trim().toLowerCase();
    return projects.find((p) => p.name.trim().toLowerCase() === key)?.id ?? NEW_PROJECT;
  }
  return projects[0]?.id ?? NEW_PROJECT;
}

// Hộp thoại hiện sau khi tải video hoặc thư mục xong: chọn project để lưu các video vừa tải.
// Đóng (× hoặc Esc) thì không thêm vào project, video giữ nguyên chỗ đang nằm.
export default function SaveLocationDialog({ count, projects, initial, folderName, onSave, onCreateAndSave, onClose }) {
  const [choice, setChoice] = useState(() => initialChoice(projects, initial, folderName));
  const [newName, setNewName] = useState(folderName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const creating = choice === NEW_PROJECT;
  const canSubmit = creating ? newName.trim() !== "" : projects.some((p) => p.id === choice);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      if (creating) await onCreateAndSave(newName.trim());
      else await onSave(choice);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="save-location-title" onSubmit={handleSubmit}>
        <div className="dialog-header">
          <h2 id="save-location-title">
            {folderName ? `Lưu ${count} video của folder "${folderName}" vào đâu?` : `Lưu ${count} video vào đâu?`}
          </h2>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        <div className="location-list" role="radiogroup" aria-labelledby="save-location-title">
          {projects.map((project) => (
            <label key={project.id} className={choice === project.id ? "location-option selected" : "location-option"}>
              <input
                type="radio"
                name="location"
                value={project.id}
                checked={choice === project.id}
                onChange={() => setChoice(project.id)}
              />
              <FolderIcon open={choice === project.id} size={22} />
              <span>{project.name}</span>
            </label>
          ))}
          <label className={creating ? "location-option selected" : "location-option"}>
            <input type="radio" name="location" checked={creating} onChange={() => setChoice(NEW_PROJECT)} />
            <span className="location-new-icon">+</span>
            <span>Tạo project mới</span>
          </label>
          {creating && (
            <input
              className="location-new-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Tên project mới"
              maxLength={100}
              autoFocus
            />
          )}
        </div>

        {error && <p className="project-name-error">{error}</p>}

        <div className="dialog-actions">
          <span className="dialog-hint">Không muốn thêm vào project thì bấm × để đóng.</span>
          <button type="submit" className="btn btn-primary" disabled={saving || !canSubmit}>
            {saving ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </form>
    </div>
  );
}
