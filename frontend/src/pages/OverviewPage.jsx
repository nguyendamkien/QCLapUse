import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAnnotationSummaries, listProjects, listUploads } from "../api/client.js";
import { GROUPS } from "../classification/constants.js";
import { labelStatus } from "../components/labeling/VideoTree.jsx";
import "./OverviewPage.css";

const ALL = "all";
const SCOPE_KEY = "overview.scope";

function readScope() {
  try {
    return localStorage.getItem(SCOPE_KEY) ?? ALL;
  } catch {
    return ALL;
  }
}

function writeScope(value) {
  try {
    localStorage.setItem(SCOPE_KEY, value);
  } catch {
    // Trình duyệt chặn localStorage thì chỉ không nhớ được phạm vi đã chọn
  }
}

const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

function formatTotalDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} giờ ${m} phút` : `${m} phút`;
}

// Số liệu của một nhóm video (cả hệ thống, một project, hoặc video nằm ngoài project)
function summarize(videos, summaries) {
  const classified = videos.filter((u) => u.group);
  // Tiến độ gán nhãn tính trên mọi video, giống số (đã hoàn thành / tổng) ở trang Gán nhãn
  const labelStates = videos.map((u) => labelStatus(u, summaries[u.id]));
  return {
    total: videos.length,
    duration: videos.reduce((sum, u) => sum + (u.duration ?? 0), 0),
    classified: classified.length,
    byGroup: Object.fromEntries(GROUPS.map((g) => [g.value, videos.filter((u) => u.group === g.value).length])),
    labeled: labelStates.filter((s) => s === "done" || s === "empty").length,
    labeling: labelStates.filter((s) => s === "doing").length,
    autoPending: labelStates.filter((s) => s === "review").length,
  };
}

// Màu nhóm đã kiểm tra phân biệt được với người mù màu (xem OverviewPage.css)
const GROUP_CLASS = { using: "seg-using", not_using: "seg-not-using" };

function GroupBar({ stats }) {
  const unclassified = stats.total - stats.classified;
  if (stats.total === 0) return <span className="muted">—</span>;
  const title = [
    ...GROUPS.map((g) => `${g.name}: ${stats.byGroup[g.value]}`),
    `Chưa phân loại: ${unclassified}`,
  ].join("\n");
  return (
    <div className="group-bar" title={title} role="img" aria-label={title.replaceAll("\n", ", ")}>
      {GROUPS.map(
        (g) =>
          stats.byGroup[g.value] > 0 && (
            <span
              key={g.value}
              className={`group-seg ${GROUP_CLASS[g.value]}`}
              style={{ flexGrow: stats.byGroup[g.value] }}
            />
          )
      )}
      {unclassified > 0 && <span className="group-seg seg-empty" style={{ flexGrow: unclassified }} />}
    </div>
  );
}

function Meter({ value, total, label, detail }) {
  const pct = percent(value, total);
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="meter-value">
          {value}/{total} · {pct}%
        </span>
      </div>
      <div className="meter-track" title={`${label}: ${value}/${total} (${pct}%)`}>
        <span className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      {detail && <p className="meter-detail">{detail}</p>}
    </div>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div className="card stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function OverviewPage() {
  const navigate = useNavigate();
  const [uploads, setUploads] = useState([]);
  const [projects, setProjects] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedScope, setSavedScope] = useState(readScope);

  useEffect(() => {
    Promise.all([listUploads(), listProjects(), getAnnotationSummaries()])
      .then(([uploadList, projectList, summaryMap]) => {
        setUploads(uploadList);
        setProjects(projectList);
        setSummaries(summaryMap);
      })
      .catch((err) => setError(`Không tải được số liệu: ${err.message}`))
      .finally(() => setLoading(false));
  }, []);

  // Project đã chọn lần trước bị xoá thì xem tất cả
  const scope = savedScope === ALL || projects.some((p) => p.id === savedScope) ? savedScope : ALL;
  const selectScope = (value) => {
    setSavedScope(value);
    writeScope(value);
  };

  const inScope = useMemo(
    () => (scope === ALL ? uploads : uploads.filter((u) => u.project_id === scope)),
    [uploads, scope]
  );
  const stats = useMemo(() => summarize(inScope, summaries), [inScope, summaries]);

  const projectRows = useMemo(() => {
    const rows = projects.map((p) => ({
      key: p.id,
      project: p,
      stats: summarize(
        uploads.filter((u) => u.project_id === p.id),
        summaries
      ),
    }));
    const loose = uploads.filter((u) => !u.project_id);
    if (loose.length > 0) rows.push({ key: "loose", project: null, stats: summarize(loose, summaries) });
    return scope === ALL ? rows : rows.filter((r) => r.key === scope);
  }, [projects, uploads, summaries, scope]);

  // Việc cần xử lý trong phạm vi đang xem
  const autoPendingVideos = inScope.filter((u) => labelStatus(u, summaries[u.id]) === "review");
  const proxyErrors = inScope.filter((u) => u.proxy_status === "error");
  const looseCount = scope === ALL ? uploads.filter((u) => !u.project_id).length : 0;
  const todos = [
    autoPendingVideos.length > 0 && {
      key: "auto",
      count: autoPendingVideos.length,
      text: "video có nhãn auto label chờ xác nhận",
      to: `/labeling?video=${autoPendingVideos[0].id}`,
      action: "Xác nhận",
    },
    proxyErrors.length > 0 && {
      key: "proxy",
      count: proxyErrors.length,
      text: "video lỗi chuyển định dạng, trình duyệt chưa phát được",
      to: proxyErrors[0].project_id ? `/upload?project=${proxyErrors[0].project_id}` : "/upload",
      action: "Mở",
    },
    looseCount > 0 && {
      key: "loose",
      count: looseCount,
      text: "video chưa thuộc project nào nên chưa phân loại / gán nhãn được",
      to: "/upload",
      action: "Thêm vào project",
    },
  ].filter(Boolean);

  const scopeName = scope === ALL ? "tất cả project" : projects.find((p) => p.id === scope)?.name;

  return (
    <section className="overview-page">
      <div className="overview-heading">
        <h1 className="page-title">Tổng quan</h1>
        {projects.length > 0 && (
          <label className="overview-scope">
            <span>Xem</span>
            <select value={scope} onChange={(e) => selectScope(e.target.value)}>
              <option value={ALL}>Tất cả project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <p className="upload-notice" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="muted">Đang tải số liệu...</p>
      ) : uploads.length === 0 ? (
        <div className="card overview-empty">
          <p>Chưa có video nào.</p>
          <Link className="btn btn-primary" to="/upload">
            Tới trang Tải dữ liệu
          </Link>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatTile
              label="Video"
              value={stats.total}
              sub={`${formatTotalDuration(stats.duration)}${scope === ALL ? ` · ${projects.length} project` : ""}`}
            />
            <StatTile
              label="Đã phân loại"
              value={`${percent(stats.classified, stats.total)}%`}
              sub={`${stats.classified}/${stats.total} video`}
            />
            <StatTile
              label="Đã gán nhãn xong"
              value={`${percent(stats.labeled, stats.total)}%`}
              sub={`${stats.labeled}/${stats.total} video`}
            />
            <StatTile
              label="Chờ xác nhận auto label"
              value={stats.autoPending}
              sub={`${stats.labeling} video đang gán nhãn`}
            />
          </div>

          <div className="overview-grid">
            <div className="card overview-card">
              <h2 className="overview-card-title">Tiến độ luồng QC · {scopeName}</h2>
              <Meter
                label="1. Phân loại"
                value={stats.classified}
                total={stats.total}
                detail={`${stats.total - stats.classified} video chưa phân loại`}
              />
              <Meter
                label="2. Gán nhãn"
                value={stats.labeled}
                total={stats.total}
                detail={`${stats.labeling} đang gán · ${stats.autoPending} chờ xác nhận auto label · ${
                  stats.total - stats.labeled - stats.labeling - stats.autoPending
                } chưa gán`}
              />
            </div>

            <div className="card overview-card">
              <h2 className="overview-card-title">Cần xử lý</h2>
              {todos.length === 0 ? (
                <p className="todo-empty">Không có việc tồn đọng.</p>
              ) : (
                <ul className="todo-list">
                  {todos.map((t) => (
                    <li key={t.key} className="todo-item">
                      <span className="todo-count">{t.count}</span>
                      <span className="todo-text">{t.text}</span>
                      <Link className="btn btn-small" to={t.to}>
                        {t.action}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card overview-card">
            <div className="project-table-head">
              <h2 className="overview-card-title">Theo project</h2>
              <div className="legend" aria-hidden="true">
                <span className="legend-item">
                  <span className="legend-swatch seg-using" /> Có người sử dụng
                </span>
                <span className="legend-item">
                  <span className="legend-swatch seg-not-using" /> Không có người sử dụng
                </span>
                <span className="legend-item">
                  <span className="legend-swatch seg-empty" /> Chưa phân loại
                </span>
              </div>
            </div>
            <div className="upload-table-wrap">
              <table className="project-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th className="num">Video</th>
                    <th>Phân nhóm</th>
                    <th>Gán nhãn</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {projectRows.map(({ key, project, stats: s }) => (
                    <tr key={key}>
                      <td className={project ? "project-name" : "project-name muted"}>
                        {project ? project.name : "Chưa có project"}
                      </td>
                      <td className="num">{s.total}</td>
                      <td className="bar-cell">
                        <GroupBar stats={s} />
                      </td>
                      <td className="bar-cell">
                        {s.total > 0 ? (
                          <div className="mini-meter" title={`Đã gán xong ${s.labeled}/${s.total}`}>
                            <div className="meter-track">
                              <span className="meter-fill" style={{ width: `${percent(s.labeled, s.total)}%` }} />
                            </div>
                            <span className="mini-meter-value">{percent(s.labeled, s.total)}%</span>
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <Link className="btn btn-small" to={project ? `/upload?project=${project.id}` : "/upload"}>
                            Mở
                          </Link>
                          {project && s.total > 0 && (
                            <Link className="btn btn-small" to={`/labeling?project=${project.id}`}>
                              Gán nhãn
                            </Link>
                          )}
                          {project && (
                            // Chỉ bấm được khi mọi video của project đã gán nhãn xong
                            <button
                              type="button"
                              className="btn btn-small"
                              disabled={s.total === 0 || s.labeled < s.total}
                              title={
                                s.total > 0 && s.labeled === s.total
                                  ? "Sang trang Đánh giá với project này"
                                  : "Cần gán nhãn xong mọi video của project trước khi đánh giá"
                              }
                              onClick={() => navigate(`/evaluation?project=${encodeURIComponent(project.id)}`)}
                            >
                              Đánh giá
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
