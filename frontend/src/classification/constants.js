// Giữ khớp với VideoGroup ở schemas/upload.py của backend.
// Video chỉ chia hai nhóm: có người sử dụng laptop và không có người sử dụng.
export const GROUPS = [
  { value: "using", name: "Có người sử dụng", key: "1" },
  { value: "not_using", name: "Không có người sử dụng", key: "2" },
];

export const findGroup = (value) => GROUPS.find((g) => g.value === value);

export const groupName = (value) => findGroup(value)?.name ?? "Chưa phân loại";


function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Đoán nhóm từ tên thư mục lúc tải lên, ví dụ "khong_dung" hay "Có người dùng".
// Chỉ là gợi ý, video vẫn nằm ở "Chưa phân loại" cho tới khi có người xác nhận.
export function guessGroup(folderName) {
  if (!folderName) return null;
  const words = normalize(folderName);
  const joined = words.join("");
  // Xét "không" trước vì "khong dung" cũng chứa "dung"
  if (joined.includes("khong") || joined.includes("notusing") || words.some((w) => ["no", "not", "negative"].includes(w))) {
    return "not_using";
  }
  if (joined.includes("conguoi") || joined.includes("using") || words.some((w) => ["dung", "positive"].includes(w))) {
    return "using";
  }
  return null;
}

// Folder phân loại bên trong một project. Mỗi folder là một bộ lọc theo nhóm;
// target là nhóm gán cho video khi kéo thả vào folder đó.
export const CLASSIFY_FOLDERS = [
  { key: "unclassified", label: "Chưa phân loại", match: (u) => !u.group, target: { group: null } },
  ...GROUPS.map((g) => ({
    key: g.value,
    label: g.name,
    match: (u) => u.group === g.value,
    target: { group: g.value },
  })),
];

export const findClassifyFolder = (key) => CLASSIFY_FOLDERS.find((f) => f.key === key) ?? CLASSIFY_FOLDERS[0];

// Kiểu dữ liệu khi kéo video (theo id) sang folder phân loại hoặc project khác
export const UPLOAD_DRAG_TYPE = "application/x-upload-ids";
