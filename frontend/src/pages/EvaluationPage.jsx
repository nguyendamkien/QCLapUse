import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  deleteEvaluation,
  evaluationDownloadUrl,
  getEvaluation,
  listEvaluations,
  listProjects,
  listUploads,
} from "../api/client.js";
import ErrorsTab from "../components/evaluation/ErrorsTab.jsx";
import ReportTab from "../components/evaluation/ReportTab.jsx";
import ResultTab from "../components/evaluation/ResultTab.jsx";
import RunForm from "../components/evaluation/RunForm.jsx";
import { formatDate, formatRatio } from "../evaluation/constants.js";
import { readProjectChoice, writeProjectChoice } from "../projectChoice.js";
import "./EvaluationPage.css";
import "../components/evaluation/ReportTab.css";

// Trang "Đánh giá" có hai phần:
// - Đánh giá hiện tại (mặc định): chọn model, chạy, kết quả hiện ngay dưới form.
// - Lịch sử đánh giá: các lượt đã chạy trước, xem theo tab Kết quả / Ca lỗi / Báo cáo.
//   ?run=<id>&tab=<result|errors|report> mở thẳng một lượt trong lịch sử.
//   ?project=<id> chọn sẵn project.

const TABS = [
  { key: "result", label: "Kết quả" },
  { key: "errors", label: "Ca lỗi" },
  { key: "report", label: "Báo cáo" },
];

function RunHeader({ run, onDeleted, onError }) {
  const remove = async () => {
    if (!window.confirm(`Xoá lượt đánh giá "${run.name}"? Báo cáo của lượt này cũng mất.`)) return;
    try {
      await deleteEvaluation(run.id);
      onDeleted(run.id);
    } catch (err) {
      onError(`Không xoá được: ${err.message}`);
    }
  };

  const { params } = run;
  return (
    <div className="card run-head no-print">
      <div>
        <h2 className="eval-card-title">
          {run.name}
          <span className={run.report.status === "approved" ? "run-status approved" : "run-status"}>
            {run.report.status === "approved" ? "✓ Đã duyệt" : "Bản nháp"}
          </span>
        </h2>
        <p className="run-meta">
          {run.model && <>Model <strong>{run.model}</strong> · </>}
          {run.source === "model"
            ? `chạy trên máy chủ${run.classes ? `, lớp ${run.classes.join(", ")}` : ""} · `
            : "từ file kết quả · "}
          {formatDate(run.created_at)} · {run.video_count} video được chấm · IoU ≥ {params.iou_threshold} · score ≥{" "}
          {params.score_threshold} · mỗi {params.frame_step} frame
        </p>
      </div>
      <div className="run-actions">
        <a className="btn btn-small" href={evaluationDownloadUrl(run.id)}>
          Tải JSON
        </a>
        <button type="button" className="btn btn-small btn-danger" onClick={remove}>
          Xoá
        </button>
      </div>
    </div>
  );
}

// Thanh tab Kết quả / Ca lỗi / Báo cáo và nội dung tab, dùng chung cho lượt vừa chạy và lượt trong lịch sử
function RunTabs({ run, tab, onTab, previous, history, onChanged, onError }) {
  const unreviewed = run.videos.filter((v) => v.has_error && v.review === "unreviewed").length;
  return (
    <>
      <div className="eval-tabs no-print" role="tablist" aria-label="Nội dung lượt đánh giá">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "eval-tab active" : "eval-tab"}
            onClick={() => onTab(t.key)}
          >
            {t.label}
            {t.key === "errors" && <span className={unreviewed ? "tab-count warn" : "tab-count"}>{run.error_video_count}</span>}
          </button>
        ))}
      </div>
      {tab === "result" && <ResultTab key={run.id} run={run} />}
      {tab === "errors" && <ErrorsTab key={run.id} run={run} onChanged={onChanged} onError={onError} />}
      {tab === "report" && (
        <ReportTab
          key={run.id}
          run={run}
          previous={previous}
          history={history}
          onChanged={onChanged}
          onError={onError}
          onOpenErrors={() => onTab("errors")}
        />
      )}
    </>
  );
}

export default function EvaluationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  // ?project=<id> (từ nút Đánh giá ở trang Gán nhãn) chọn sẵn project đó
  const [projectChoice, setProjectChoice] = useState(() => {
    const fromUrl = searchParams.get("project");
    if (fromUrl) writeProjectChoice(fromUrl);
    return fromUrl ?? readProjectChoice();
  });
  const [runs, setRuns] = useState([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [run, setRun] = useState(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const runId = searchParams.get("run");
  // Có ?run= (link tới một lượt cũ) thì mở thẳng lịch sử
  const [showHistory, setShowHistory] = useState(() => Boolean(runId));
  // Kết quả của lượt vừa chạy ở phần Đánh giá hiện tại, và tab đang xem của lượt đó
  const [currentRun, setCurrentRun] = useState(null);
  const [currentTab, setCurrentTab] = useState("result");
  // Video của mọi project, để lượt giả lập dùng đúng tên video của project
  const [uploads, setUploads] = useState([]);
  const tab = TABS.some((t) => t.key === searchParams.get("tab")) ? searchParams.get("tab") : "result";
  const project = projects.find((p) => p.id === projectChoice) ?? projects[0] ?? null;

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((err) => setNotice(`Không tải được danh sách project: ${err.message}`))
      .finally(() => setLoading(false));
    listUploads()
      .then(setUploads)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!project) return;
    setRunsLoaded(false);
    listEvaluations(project.id)
      .then(setRuns)
      .catch((err) => setNotice(`Không tải được các lượt đánh giá: ${err.message}`))
      .finally(() => setRunsLoaded(true));
  }, [project?.id]);

  // Lượt đang xem: theo ?run=, không có thì lượt mới nhất của project
  const activeId = runId ?? runs[0]?.id ?? null;
  useEffect(() => {
    if (!activeId) {
      setRun(null);
      return;
    }
    getEvaluation(activeId)
      .then((r) => {
        setRun(r);
        // Mở link ?run= của project khác thì chuyển sang project đó
        if (r.project_id !== projectChoice) {
          setProjectChoice(r.project_id);
          writeProjectChoice(r.project_id);
        }
      })
      .catch((err) => setNotice(`Không mở được lượt đánh giá: ${err.message}`));
  }, [activeId]);

  // Báo cáo so với lượt trước và vẽ xu hướng theo thời gian: cũ trước
  const history = useMemo(() => [...runs].reverse(), [runs]);
  const index = history.findIndex((r) => r.id === run?.id);
  const previous = index > 0 ? history[index - 1] : null;
  // Lượt vừa chạy so với lượt mới nhất đã lưu; xu hướng thêm lượt vừa chạy vào cuối
  const currentHistory = useMemo(() => (currentRun ? [...history, currentRun] : history), [history, currentRun]);

  const selectProject = (id) => {
    setProjectChoice(id);
    writeProjectChoice(id);
    // Xoá ngay danh sách cũ, nếu không lượt mới nhất của project trước sẽ được mở lại
    setRuns([]);
    setRun(null);
    setCurrentRun(null);
    setSearchParams({});
  };

  const openRun = (id, nextTab = tab) =>
    setSearchParams(nextTab === "result" ? { run: id } : { run: id, tab: nextTab });

  const openTab = (key) => run && openRun(run.id, key);

  // Lượt vừa chạy hiện ngay dưới form. Lượt thật cũng được thêm vào lịch sử; lượt giả lập thì không
  const handleDone = (newRun) => {
    setCurrentRun(newRun);
    setCurrentTab("result");
    if (!newRun.fake) setRuns((prev) => [newRun, ...prev]);
  };

  const handleChanged = (updated) => {
    setRun(updated);
    setRuns((prev) => prev.map((r) => (r.id === updated.id ? { ...r, report: updated.report } : r)));
  };

  const handleDeleted = (id) => {
    setRuns((prev) => prev.filter((r) => r.id !== id));
    setRun(null);
    setSearchParams({});
  };

  return (
    <section className="eval-page">
      <div className="eval-heading no-print">
        <h1 className="page-title">Đánh giá</h1>
        {projects.length > 0 && (
          <div className="eval-heading-actions">
            <label className="eval-project">
              <span>Project</span>
              <select value={project?.id ?? ""} onChange={(e) => selectProject(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setShowHistory((open) => !open)}
              aria-pressed={showHistory}
            >
              {showHistory ? "← Đánh giá hiện tại" : `Lịch sử đánh giá${runs.length ? ` (${runs.length})` : ""}`}
            </button>
          </div>
        )}
      </div>

      {notice && (
        <p className="upload-notice no-print" role="alert">
          {notice}
          <button type="button" className="btn btn-small" onClick={() => setNotice("")}>
            Đóng
          </button>
        </p>
      )}

      {loading ? (
        <p className="muted">Đang tải...</p>
      ) : !project ? (
        <div className="card">
          Chưa có project. <Link to="/upload">Tạo project và tải video</Link> rồi gán nhãn trước khi đánh giá model.
        </div>
      ) : (
        <>
          {/* Ẩn chứ không bỏ phần đánh giá hiện tại khi xem lịch sử, để lượt đang chạy vẫn được theo dõi */}
          <div className="eval-current" hidden={showHistory}>
            <div className="run-form-wrap no-print">
              <RunForm
                key={project.id}
                projectId={project.id}
                projectName={project.name}
                uploads={uploads.filter((u) => u.project_id === project.id)}
                onDone={handleDone}
              />
            </div>
            {currentRun && (
              <div className="current-result">
                <div className="card run-head">
                  <div>
                    <h2 className="eval-card-title">
                      Kết quả đánh giá
                    </h2>
                    <p className="run-meta">
                      Model <strong>{currentRun.model}</strong>
                      {currentRun.classes && ` · lớp ${currentRun.classes.join(", ")}`} · {formatDate(currentRun.created_at)} ·{" "}
                      {currentRun.video_count} video được chấm · IoU ≥ {currentRun.params.iou_threshold} · score ≥{" "}
                      {currentRun.params.score_threshold} · mỗi {currentRun.params.frame_step} frame
                    </p>
                  </div>
                </div>
                <RunTabs
                  run={currentRun}
                  tab={currentTab}
                  onTab={setCurrentTab}
                  previous={runs[0] ?? null}
                  history={currentHistory}
                  onChanged={setCurrentRun}
                  onError={setNotice}
                />
              </div>
            )}
          </div>

          <div className="eval-layout" hidden={!showHistory}>
            <aside className="card run-list no-print">
              <h2 className="eval-card-title">Các lượt · {runs.length}</h2>
              {runs.length === 0 ? (
                <p className="muted">{runsLoaded ? "Chưa có lượt đánh giá nào." : "Đang tải..."}</p>
              ) : (
                <ul>
                  {runs.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className={r.id === run?.id ? "run-item active" : "run-item"}
                        onClick={() => openRun(r.id)}
                      >
                        <span className="run-item-name">{r.name}</span>
                        <span className="run-item-meta">
                          P {formatRatio(r.box.precision)} · R {formatRatio(r.box.recall)}
                          {r.report.status === "approved" && " · ✓ đã duyệt"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            <div className="eval-main">
              {run ? (
                <>
                  <RunHeader run={run} onDeleted={handleDeleted} onError={setNotice} />
                  <RunTabs
                    run={run}
                    tab={tab}
                    onTab={openTab}
                    previous={previous}
                    history={history}
                    onChanged={handleChanged}
                    onError={setNotice}
                  />
                </>
              ) : (
                <div className="card eval-placeholder">
                  {runsLoaded && runs.length === 0 ? (
                    <>
                      Project <strong>{project.name}</strong> chưa có lượt đánh giá nào được lưu.
                    </>
                  ) : (
                    "Đang tải lượt đánh giá..."
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
