import { groupName } from "../../classification/constants.js";
import { TARGETS, formatPercent } from "../../evaluation/constants.js";
import MetricTile from "./MetricTile.jsx";

// Tab "Kết quả": chỉ số so với ngưỡng, mức video, mức box theo nhóm, các cảnh báo khi chấm
export default function ResultTab({ run }) {
  const { params } = run;
  const missing = run.videos.filter((v) => !v.in_prediction_file).length;
  return (
    <div className="run-detail">
      <div className="metric-grid">
        <MetricTile label="Precision (mức box)" value={run.box.precision} target={TARGETS.precision} sub={`${run.box.tp} đúng · ${run.box.fp} thừa`} />
        <MetricTile label="Recall (mức box)" value={run.box.recall} target={TARGETS.recall} sub={`${run.box.tp} đúng · ${run.box.fn} bỏ sót`} />
        <MetricTile label="F1 (mức box)" value={run.box.f1} />
        <MetricTile
          label="Độ chính xác mức video"
          value={run.video.accuracy}
          sub={`${run.video.tp + run.video.tn}/${run.video_count} video nhận đúng nhóm`}
        />
      </div>

      {(run.skipped.length > 0 || run.unmatched_prediction_keys.length > 0 || missing > 0) && (
        <div className="card eval-warnings">
          {missing > 0 && <p>⚠ {missing} video không có trong file dự đoán, được tính là model không phát hiện gì.</p>}
          {run.unmatched_prediction_keys.length > 0 && (
            <p>
              ⚠ {run.unmatched_prediction_keys.length} khoá trong file không khớp video nào của project:{" "}
              <code>{run.unmatched_prediction_keys.slice(0, 5).join(", ")}</code>
              {run.unmatched_prediction_keys.length > 5 && " ..."}
            </p>
          )}
          {run.skipped.length > 0 && (
            <details>
              <summary>ⓘ {run.skipped.length} video bị bỏ qua vì chưa đủ điều kiện</summary>
              <ul>
                {run.skipped.map((s) => (
                  <li key={s.upload_id}>
                    <strong>{s.name}</strong>: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="eval-two">
        <div className="card">
          <h3 className="eval-sub-title">Mức video</h3>
          <table className="confusion">
            <thead>
              <tr>
                <th />
                <th>Model: có người</th>
                <th>Model: không có</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Thực tế: có người</th>
                <td className="hit">{run.video.tp}</td>
                <td className={run.video.fn ? "miss" : ""}>{run.video.fn}</td>
              </tr>
              <tr>
                <th>Thực tế: không có</th>
                <td className={run.video.fp ? "miss" : ""}>{run.video.fp}</td>
                <td className="hit">{run.video.tn}</td>
              </tr>
            </tbody>
          </table>
          <p className="eval-help">
            Video được tính là model báo "có người" khi có ít nhất {params.min_frames_video} frame được chấm có box.
          </p>
        </div>
        <div className="card">
          <h3 className="eval-sub-title">Mức box theo nhóm</h3>
          <table className="eval-table">
            <thead>
              <tr>
                <th>Nhóm</th>
                <th className="num">Đúng</th>
                <th className="num">Thừa</th>
                <th className="num">Bỏ sót</th>
                <th className="num">Precision</th>
                <th className="num">Recall</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(run.box_by_group).map(([group, m]) => (
                <tr key={group}>
                  <td>{groupName(group)}</td>
                  <td className="num">{m.tp}</td>
                  <td className="num">{m.fp}</td>
                  <td className="num">{m.fn}</td>
                  <td className="num">{formatPercent(m.precision)}</td>
                  <td className="num">{formatPercent(m.recall)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="eval-help">Video không có người sử dụng chỉ có box thừa: đo tỷ lệ báo nhầm của model.</p>
        </div>
      </div>

    </div>
  );
}
