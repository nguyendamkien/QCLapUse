// Ngưỡng chấp nhận đề xuất trong doc/luong-qc.md, cần chốt với team model
export const TARGETS = {
  precision: 0.9,
  recall: 0.85,
};

export const DEFAULT_PARAMS = {
  iou_threshold: 0.5,
  score_threshold: 0.5,
  frame_step: 5,
  min_frames_video: 3,
};

// QC lead phân loại từng video có lỗi: lỗi do nhãn (quay lại gán nhãn) hay do model (ghi vào báo cáo)
export const REVIEW_OPTIONS = [
  { value: "unreviewed", label: "Chưa xem" },
  { value: "label_error", label: "Lỗi nhãn" },
  { value: "model_error", label: "Lỗi model" },
  { value: "not_error", label: "Không phải lỗi" },
];

export const reviewLabel = (value) => REVIEW_OPTIONS.find((o) => o.value === value)?.label ?? value;

export const formatRatio = (value) => (value == null ? "—" : value.toFixed(3));

export const formatPercent = (value) => (value == null ? "—" : `${Math.round(value * 100)}%`);

export function formatDate(iso) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// null khi chưa tính được (không có box nào), true / false khi so với ngưỡng
export const meetsTarget = (value, target) => (value == null ? null : value >= target);
