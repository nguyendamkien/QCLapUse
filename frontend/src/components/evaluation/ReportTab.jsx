import { useMemo, useState } from "react";
import { updateEvaluationReport } from "../../api/client.js";
import { groupName } from "../../classification/constants.js";
import { REVIEW_OPTIONS, TARGETS, formatDate, formatRatio, meetsTarget, reviewLabel } from "../../evaluation/constants.js";
import { fakeUpdateReport } from "../../evaluation/fakeRun.js";
import MetricTile from "./MetricTile.jsx";

// Ba đường của biểu đồ xu hướng, màu đã kiểm tra phân biệt được với người mù màu (xem ReportTab.css)
const SERIES = [
  { key: "precision", label: "Precision", className: "series-precision" },
  { key: "recall", label: "Recall", className: "series-recall" },
  { key: "f1", label: "F1", className: "series-f1" },
];

function formatDelta(current, previous) {
  if (current == null || previous == null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 0.0005) return { text: "±0", className: "delta-flat" };
  return { text: `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(3)}`, className: diff > 0 ? "delta-up" : "delta-down" };
}

// Đề xuất tự sinh từ kết quả, để QC lead sửa / bổ sung trong phần nhận xét
function buildSuggestions(run) {
  const items = [];
  const { box } = run;
  const fpNotUsing = run.box_by_group.not_using?.fp ?? 0;
  const count = (review) => run.videos.filter((v) => v.has_error && v.review === review).length;

  if (meetsTarget(box.precision, TARGETS.precision) === false) {
    items.push(
      `Precision ${formatRatio(box.precision)} chưa đạt ${TARGETS.precision}: model báo thừa ${box.fp} box` +
        (fpNotUsing ? `, trong đó ${fpNotUsing} box trên video không có người sử dụng. Cần thêm negative khó (laptop không ai dùng) cho team model.` : ".")
    );
  }
  if (meetsTarget(box.recall, TARGETS.recall) === false) {
    items.push(
      `Recall ${formatRatio(box.recall)} chưa đạt ${TARGETS.recall}: model bỏ sót ${box.fn} box. Xem các ca bỏ sót để biết tư thế nào hay bị sót (cầm, mang máy...).`
    );
  }
  if (run.video.fn) items.push(`${run.video.fn} video có người sử dụng nhưng model không nhận ra ở mức video.`);
  if (run.video.fp) items.push(`${run.video.fp} video không có người sử dụng nhưng model báo có.`);
  if (count("label_error")) items.push(`${count("label_error")} video lỗi do nhãn: sửa nhãn ở trang Gán nhãn rồi chạy lại đánh giá.`);
  if (count("model_error")) items.push(`${count("model_error")} video lỗi do model: gửi danh sách ca lỗi cho team model.`);
  if (count("unreviewed")) items.push(`Còn ${count("unreviewed")} video có lỗi chưa được phân loại (do nhãn hay do model).`);
  if (run.skipped.length) items.push(`${run.skipped.length} video chưa đủ điều kiện nên chưa được chấm, cần hoàn thiện nhãn.`);
  if (items.length === 0) items.push("Các chỉ số đạt ngưỡng và không còn ca lỗi cần xử lý.");
  return items;
}

// Biểu đồ đường precision / recall / F1 qua các lượt đánh giá (cũ bên trái, mới bên phải)
function TrendChart({ runs, activeId }) {
  const [hover, setHover] = useState(null);
  const W = 640;
  const H = 220;
  const pad = { top: 16, right: 64, bottom: 28, left: 40 };
  const values = runs.flatMap((r) => SERIES.map((s) => r.box[s.key])).filter((v) => v != null);
  // Trục y bắt đầu dưới giá trị thấp nhất một chút (không từ 0) để thấy rõ chênh lệch; ghi rõ trên trục
  const yMin = Math.max(0, Math.floor((Math.min(...values, TARGETS.recall) - 0.05) * 10) / 10);
  const x = (i) => pad.left + (runs.length === 1 ? 0 : (i / (runs.length - 1)) * (W - pad.left - pad.right));
  const y = (v) => pad.top + (1 - (v - yMin) / (1 - yMin)) * (H - pad.top - pad.bottom);
  const ticks = [];
  for (let t = yMin; t <= 1.0001; t += 0.1) ticks.push(Math.round(t * 10) / 10);
  const last = runs.length - 1;

  return (
    <div className="trend">
      <div className="trend-legend">
        {SERIES.map((s) => (
          <span key={s.key} className="legend-item">
            <span className={`legend-line ${s.className}`} /> {s.label}
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-line legend-target" /> Ngưỡng
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label="Xu hướng precision, recall, F1 qua các lượt đánh giá">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} />
            <text className="axis-text" x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        {[
          { v: TARGETS.precision, label: `P ≥ ${TARGETS.precision}` },
          { v: TARGETS.recall, label: `R ≥ ${TARGETS.recall}` },
        ].map((t) => (
          <g key={t.label}>
            <line className="target-line" x1={pad.left} x2={W - pad.right} y1={y(t.v)} y2={y(t.v)} />
            <text className="target-text" x={pad.left + 4} y={y(t.v) - 4}>
              {t.label}
            </text>
          </g>
        ))}
        {runs.map((r, i) => (
          <text key={r.id} className={r.id === activeId ? "axis-text axis-active" : "axis-text"} x={x(i)} y={H - 8} textAnchor="middle">
            #{i + 1}
          </text>
        ))}
        {hover != null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={H - pad.bottom} />}
        {SERIES.map((s) => {
          const points = runs.map((r, i) => [i, r.box[s.key]]).filter(([, v]) => v != null);
          const d = points.map(([i, v], k) => `${k ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
          const end = points.at(-1);
          return (
            <g key={s.key} className={s.className}>
              <path className="series-line" d={d} />
              {points.map(([i, v]) => (
                <circle key={i} className="series-dot" cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4} />
              ))}
              {/* Nhãn giá trị ở điểm cuối, để không phải dựa vào màu mới biết đường nào */}
              {end && end[0] === last && (
                <text className="end-label" x={x(end[0]) + 8} y={y(end[1])} dy="0.32em">
                  {s.label.slice(0, 1)} {end[1].toFixed(2)}
                </text>
              )}
            </g>
          );
        })}
        {runs.map((r, i) => (
          <rect
            key={r.id}
            className="hit-area"
            x={x(i) - (W - pad.left - pad.right) / Math.max(1, runs.length - 1) / 2}
            y={pad.top}
            width={(W - pad.left - pad.right) / Math.max(1, runs.length - 1)}
            height={H - pad.top - pad.bottom}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover != null && (
        <div className="trend-tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>
            #{hover + 1} · {runs[hover].name}
          </strong>
          {SERIES.map((s) => (
            <span key={s.key}>
              <span className={`legend-line ${s.className}`} /> {s.label}: {formatRatio(runs[hover].box[s.key])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Tab "Báo cáo" (bước 6): tổng hợp một lượt để QC lead nhận xét, duyệt và in
export default function ReportTab({ run, previous, history, onChanged, onError, onOpenErrors }) {
  const [note, setNote] = useState(run.report.summary_note ?? "");
  const [saving, setSaving] = useState(false);
  const suggestions = useMemo(() => buildSuggestions(run), [run]);
  const errorVideos = run.videos.filter((v) => v.has_error);
  const reviewCounts = Object.fromEntries(
    REVIEW_OPTIONS.map((o) => [o.value, errorVideos.filter((v) => v.review === o.value).length])
  );
  const approved = run.report.status === "approved";

  const save = async (changes) => {
    setSaving(true);
    try {
      // Lượt giả lập không có trên máy chủ nên chỉ sửa trong trang
      onChanged(run.fake ? fakeUpdateReport(run, changes) : await updateEvaluationReport(run.id, changes));
    } catch (err) {
      onError(`Không lưu được báo cáo: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleApprove = () => {
    if (!approved && reviewCounts.unreviewed > 0) {
      const ok = window.confirm(
        `Còn ${reviewCounts.unreviewed} video có lỗi chưa được phân loại. Vẫn duyệt báo cáo?`
      );
      if (!ok) return;
    }
    save({ summary_note: note, status: approved ? "draft" : "approved" });
  };

  const rows = [
    { label: "Precision (mức box)", key: "precision", value: run.box.precision, prev: previous?.box.precision, target: TARGETS.precision },
    { label: "Recall (mức box)", key: "recall", value: run.box.recall, prev: previous?.box.recall, target: TARGETS.recall },
    { label: "F1 (mức box)", key: "f1", value: run.box.f1, prev: previous?.box.f1 },
    { label: "Độ chính xác mức video", key: "acc", value: run.video.accuracy, prev: previous?.video.accuracy },
  ];

  return (
    <article className="card report-doc">
      <header className="report-header">
        <div>
          <p className="report-kicker">Báo cáo QC · {run.project_name}</p>
          <h2 className="report-title">{run.name}</h2>
          <p className="report-meta">
            {run.model && <>Model <strong>{run.model}</strong> · </>}
            Chạy lúc {formatDate(run.created_at)} · {run.video_count} video được chấm · IoU ≥ {run.params.iou_threshold} ·
            score ≥ {run.params.score_threshold} · mỗi {run.params.frame_step} frame
          </p>
        </div>
        <span className={approved ? "report-status approved" : "report-status"}>
          {approved ? `✓ Đã duyệt ${formatDate(run.report.approved_at)}` : "Bản nháp"}
        </span>
      </header>

      <section className="report-section">
        <h3>1. Kết quả chính</h3>
        <div className="metric-grid">
          <MetricTile label="Precision" value={run.box.precision} target={TARGETS.precision} />
          <MetricTile label="Recall" value={run.box.recall} target={TARGETS.recall} />
          <MetricTile label="F1" value={run.box.f1} />
          <MetricTile label="Độ chính xác mức video" value={run.video.accuracy} />
        </div>
        <table className="eval-table report-table">
          <thead>
            <tr>
              <th>Chỉ số</th>
              <th className="num">Lượt này</th>
              <th className="num">Ngưỡng</th>
              <th className="num">Lượt trước</th>
              <th className="num">Thay đổi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = formatDelta(r.value, r.prev);
              return (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="num">{formatRatio(r.value)}</td>
                  <td className="num">{r.target ? `≥ ${r.target}` : "—"}</td>
                  <td className="num">{previous ? formatRatio(r.prev) : "—"}</td>
                  <td className={`num ${delta?.className ?? ""}`}>{delta ? delta.text : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="eval-help">
          {previous ? `So với lượt trước: "${previous.name}" (${formatDate(previous.created_at)}).` : "Đây là lượt đánh giá đầu tiên của project."}{" "}
          Mức box: {run.box.tp} đúng · {run.box.fp} thừa · {run.box.fn} bỏ sót. Mức video: {run.video.tp + run.video.tn}/
          {run.video_count} video nhận đúng nhóm.
        </p>
      </section>

      {history.length >= 2 && (
        <section className="report-section">
          <h3>2. Xu hướng qua các lượt</h3>
          <TrendChart runs={history} activeId={run.id} />
          <details className="trend-table">
            <summary>Xem dạng bảng</summary>
            <table className="eval-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Lượt</th>
                  <th className="num">Precision</th>
                  <th className="num">Recall</th>
                  <th className="num">F1</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r, i) => (
                  <tr key={r.id} className={r.id === run.id ? "row-active" : ""}>
                    <td>{i + 1}</td>
                    <td>{r.name}</td>
                    <td className="num">{formatRatio(r.box.precision)}</td>
                    <td className="num">{formatRatio(r.box.recall)}</td>
                    <td className="num">{formatRatio(r.box.f1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      )}

      <section className="report-section">
        <h3>{history.length >= 2 ? "3" : "2"}. Ca lỗi</h3>
        <p className="report-counts">
          <span>
            <strong>{errorVideos.length}</strong>/{run.video_count} video có lỗi
          </span>
          {REVIEW_OPTIONS.map((o) => (
            <span key={o.value} className={o.value === "unreviewed" && reviewCounts.unreviewed ? "count-warn" : ""}>
              <strong>{reviewCounts[o.value]}</strong> {o.label.toLowerCase()}
            </span>
          ))}
        </p>
        {errorVideos.length > 0 && (
          <div className="upload-table-wrap">
            <table className="eval-table">
              <thead>
                <tr>
                  <th>Video</th>
                  <th>Thực tế</th>
                  <th>Model báo</th>
                  <th className="num">Thừa</th>
                  <th className="num">Bỏ sót</th>
                  <th>Phân loại</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {errorVideos.map((v) => (
                  <tr key={v.upload_id}>
                    <td className="cell-video" title={v.name}>
                      {v.name}
                    </td>
                    <td>{groupName(v.group)}</td>
                    <td>{v.predicted_using ? "Có người" : "Không có"}</td>
                    <td className="num">{v.box.fp}</td>
                    <td className="num">{v.box.fn}</td>
                    <td className={v.review === "unreviewed" ? "count-warn" : ""}>{reviewLabel(v.review)}</td>
                    <td className="cell-note">{v.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="eval-help no-print">
          Phân loại lỗi và ghi chú sửa ở{" "}
          <button type="button" className="link-button" onClick={onOpenErrors}>
            tab Ca lỗi
          </button>
          .
        </p>
      </section>

      <section className="report-section">
        <h3>{history.length >= 2 ? "4" : "3"}. Đề xuất</h3>
        <ul className="suggestions">
          {suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <label className="report-note">
          <span>Nhận xét của QC lead</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note.trim() !== (run.report.summary_note ?? "") && save({ summary_note: note })}
            rows={4}
            maxLength={5000}
            placeholder="Kết luận, hướng xử lý, việc giao cho team model..."
            disabled={approved}
          />
        </label>
        {/* Bản in hiện nhận xét dạng chữ thường thay cho ô nhập */}
        {note.trim() && <p className="print-only report-note-print">{note}</p>}
      </section>

      <footer className="report-footer no-print">
        <button type="button" className={approved ? "btn btn-outline" : "btn btn-primary"} onClick={toggleApprove} disabled={saving}>
          {approved ? "Bỏ duyệt để sửa" : "✓ Duyệt báo cáo"}
        </button>
        <button type="button" className="btn btn-small" onClick={() => window.print()}>
          In / lưu PDF
        </button>
        {approved && <span className="muted">Báo cáo đã duyệt thì không sửa được nhận xét.</span>}
      </footer>
    </article>
  );
}
