import { formatRatio, meetsTarget } from "../../evaluation/constants.js";

// Ô chỉ số chính, kèm đạt / chưa đạt ngưỡng (có chữ và biểu tượng, không chỉ dựa vào màu)
export default function MetricTile({ label, value, target, sub }) {
  const pass = target == null ? null : meetsTarget(value, target);
  return (
    <div className="card metric-tile">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{formatRatio(value)}</div>
      {target != null && (
        <div className={pass == null ? "metric-status" : pass ? "metric-status pass" : "metric-status fail"}>
          {pass == null ? "Chưa tính được" : pass ? `✓ Đạt (≥ ${target})` : `✗ Chưa đạt (≥ ${target})`}
        </div>
      )}
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}
