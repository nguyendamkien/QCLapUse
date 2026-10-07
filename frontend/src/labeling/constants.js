// Giữ khớp với schemas/annotation.py ở backend.
// Chỉ có một loại box: người đang sử dụng laptop.

// Mỗi người một màu, dùng chung cho box, thanh trượt frame và thanh thời gian
const TRACK_COLORS = ["#fbbf24", "#f472b6", "#38bdf8", "#a3e635", "#c084fc", "#fb923c"];

export const trackColor = (trackId) => TRACK_COLORS[(trackId - 1) % TRACK_COLORS.length];

// Danh sách case tạm thời, cần team chốt lại (xem doc/luong-qc.md)
export const CASES = [
  { value: "sitting", name: "Ngồi dùng máy" },
  { value: "holding", name: "Cầm máy" },
  { value: "carrying", name: "Mang máy" },
  { value: "not_using", name: "Không ai dùng máy" },
  { value: "mixed", name: "Hỗn hợp" },
];

export const caseName = (value) => CASES.find((c) => c.value === value)?.name ?? "Chưa chọn";
