import { useState } from "react";

// Ô nhập tên project, dùng khi tạo mới và khi đổi tên. onSubmit ném lỗi thì hiện lỗi cạnh ô.
export default function ProjectNameForm({ initial = "", submitLabel, onSubmit, onCancel }) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <form className="project-name-form" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="Tên project, ví dụ: Kho Đà Nẵng"
        maxLength={100}
        autoFocus
      />
      <button type="submit" className="btn btn-small" disabled={saving || !name.trim()}>
        {submitLabel}
      </button>
      <button type="button" className="btn btn-small" onClick={onCancel}>
        Huỷ
      </button>
      {error && <span className="project-name-error">{error}</span>}
    </form>
  );
}
