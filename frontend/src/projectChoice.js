// Project đang làm việc, dùng chung giữa trang Gán nhãn và trang Đánh giá:
// chọn project ở trang này thì sang trang kia vẫn là project đó.
const PROJECT_KEY = "currentProject";
// Khoá cũ của trang Gán nhãn, đọc để không mất lựa chọn đã lưu trước đây
const LEGACY_KEY = "labeling.projectId";

export function readProjectChoice() {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
}

export function writeProjectChoice(projectId) {
  try {
    localStorage.setItem(PROJECT_KEY, projectId);
  } catch {
    // Trình duyệt chặn localStorage thì chỉ không nhớ được project đã chọn
  }
}
