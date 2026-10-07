import { useEffect, useRef, useState } from "react";
import {
  deleteEvalModel,
  getEvaluation,
  getEvaluationJob,
  listEvalModels,
  listEvaluationJobs,
  startModelEvaluation,
  uploadEvalModel,
} from "../../api/client.js";
import { DEFAULT_PARAMS } from "../../evaluation/constants.js";
import { FAKE_EVALUATION, makeFakeRun } from "../../evaluation/fakeRun.js";

// Form chạy lượt đánh giá mới: chọn / tải model, chọn lớp, chạy nền và theo dõi tiến độ.
const MODEL_KEY = "evaluation.model";

function readSavedModel() {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

function saveModel(id) {
  try {
    localStorage.setItem(MODEL_KEY, id);
  } catch {
    // Trình duyệt chặn localStorage thì chỉ không nhớ được model đã chọn
  }
}

// Lớp chọn sẵn: lớp có tên liên quan tới laptop; model ít lớp thì chọn hết;
// model nhiều lớp (ví dụ COCO) thì chọn "person" nếu có
function defaultClasses(model) {
  const names = Object.values(model.classes);
  const related = names.filter((n) => /laptop|using|dung|sử dụng/i.test(n));
  if (related.length) return related;
  if (names.length <= 3) return names;
  return names.includes("person") ? ["person"] : [];
}

function formatSize(bytes) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

const JOB_POLL_MS = 1500;
// Giả lập: mỗi nhịp tăng tiến độ thêm chừng này, khoảng 3 giây là xong
const FAKE_TICK_MS = 300;
const FAKE_STEP = 0.1;

function ParamsFields({ params, onChange }) {
  const field = (key, label, attrs) => (
    <label className="eval-field">
      <span>{label}</span>
      <input type="number" value={params[key]} onChange={(e) => onChange(key, e.target.value)} {...attrs} />
    </label>
  );
  return (
    <details className="eval-details">
      <summary>Tham số chấm</summary>
      <div className="eval-params">
        {field("iou_threshold", "IoU tối thiểu để khớp box", { min: 0.05, max: 1, step: 0.05 })}
        {field("score_threshold", "Bỏ box có score dưới", { min: 0, max: 1, step: 0.05 })}
        {field("frame_step", "Chấm mỗi N frame", { min: 1, max: 1000, step: 1 })}
        {field("min_frames_video", 'Số frame có box tối thiểu để tính video "có người"', { min: 1, step: 1 })}
      </div>
    </details>
  );
}

export default function RunForm({ projectId, projectName, uploads, onDone }) {
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(readSavedModel);
  const [classes, setClasses] = useState([]);
  const [name, setName] = useState("");
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [error, setError] = useState("");
  const [job, setJob] = useState(null);
  // Tải model mới
  const modelInput = useRef(null);
  const [adding, setAdding] = useState(false);
  const [newModelFile, setNewModelFile] = useState(null);
  const [newModelName, setNewModelName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(null);

  const model = models.find((m) => m.id === modelId) ?? models[0] ?? null;
  const running = job && (job.status === "queued" || job.status === "running");
  const setParam = (key, value) => setParams((prev) => ({ ...prev, [key]: value }));

  const chooseModel = (m) => {
    setModelId(m.id);
    saveModel(m.id);
    setClasses(defaultClasses(m));
  };

  useEffect(() => {
    listEvalModels()
      .then((list) => {
        setModels(list);
        const current = list.find((m) => m.id === readSavedModel()) ?? list[0];
        if (current) setClasses(defaultClasses(current));
        if (list.length === 0) setAdding(true);
      })
      .catch((err) => setError(`Không tải được danh sách model: ${err.message}`));
    // Đang có lần chạy dở của project này (ví dụ vừa tải lại trang) thì theo dõi tiếp
    listEvaluationJobs(projectId)
      .then((jobs) => setJob(jobs.find((j) => j.status === "queued" || j.status === "running") ?? null))
      .catch(() => {});
  }, [projectId]);

  // Giả lập: tăng dần tiến độ rồi trả kết quả giả
  useEffect(() => {
    if (!running || !job.fake) return;
    const timer = setTimeout(() => {
      const progress = Math.min(1, job.progress + FAKE_STEP);
      if (progress < 1) {
        setJob({ ...job, progress, message: "Đang chạy model trên các frame..." });
      } else {
        setJob(null);
        onDone(
          makeFakeRun({ modelName: job.modelName, classes: job.classes, params: job.params, uploads, projectName })
        );
      }
    }, FAKE_TICK_MS);
    return () => clearTimeout(timer);
  }, [job]);

  // Hỏi tiến độ định kỳ tới khi chạy xong
  useEffect(() => {
    if (!running || job.fake) return;
    const timer = setInterval(async () => {
      try {
        const latest = await getEvaluationJob(job.id);
        setJob(latest);
        if (latest.status === "done") onDone(await getEvaluation(latest.run_id));
        if (latest.status === "error") setError(`Chạy model lỗi: ${latest.error}`);
      } catch (err) {
        setJob(null);
        setError(err.message);
      }
    }, JOB_POLL_MS);
    return () => clearInterval(timer);
  }, [running, job?.id]);

  const addModel = async (event) => {
    event.preventDefault();
    if (!newModelFile) return;
    setError("");
    setUploadProgress(0);
    try {
      const created = await uploadEvalModel(newModelFile, newModelName.trim(), setUploadProgress);
      setModels((prev) => [created, ...prev]);
      chooseModel(created);
      setAdding(false);
      setNewModelFile(null);
      setNewModelName("");
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadProgress(null);
    }
  };

  const removeModel = async () => {
    if (!model || !window.confirm(`Xoá model "${model.name}"? Các lượt đánh giá đã chạy vẫn giữ.`)) return;
    try {
      await deleteEvalModel(model.id);
      const rest = models.filter((m) => m.id !== model.id);
      setModels(rest);
      if (rest[0]) chooseModel(rest[0]);
      else setAdding(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const numericParams = () => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Number(v)]));

  const start = async (event) => {
    event.preventDefault();
    setError("");
    if (FAKE_EVALUATION) {
      setJob({
        fake: true,
        status: "running",
        progress: 0,
        message: "Đang chuẩn bị...",
        modelName: model?.name ?? "Chưa chọn model",
        classes,
        params: numericParams(),
      });
      return;
    }
    if (!model) return;
    try {
      setJob(
        await startModelEvaluation({
          project_id: projectId,
          model_id: model.id,
          name: name.trim() || null,
          classes: classes.length ? classes : null,
          params: numericParams(),
        })
      );
      setName("");
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleClass = (className) =>
    setClasses((prev) => (prev.includes(className) ? prev.filter((c) => c !== className) : [...prev, className]));
  const classNames = model ? Object.values(model.classes) : [];

  return (
    <div className="card eval-form">

      {/* ---------- 1. Model ---------- */}
      <div className="eval-step">
        <div className="eval-step-title">1. Model</div>
        {models.length > 0 && !adding && (
          <div className="model-row">
            <select
              value={model?.id ?? ""}
              onChange={(e) => chooseModel(models.find((m) => m.id === e.target.value))}
              aria-label="Chọn model"
              disabled={running}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-small" onClick={() => setAdding(true)} disabled={running}>
              + Tải model
            </button>
            <button type="button" className="btn btn-small btn-danger" onClick={removeModel} disabled={running} title="Xoá model này">
              ×
            </button>
          </div>
        )}
        {model && !adding && (
          <p className="eval-help model-meta">
            {model.filename} · {formatSize(model.size)} · {classNames.length} lớp
          </p>
        )}
        {adding && (
          <form className="model-add" onSubmit={addModel}>
            <input
              ref={modelInput}
              type="file"
              accept=".pt,.onnx"
              onChange={(e) => setNewModelFile(e.target.files[0] ?? null)}
              required
            />
            <input
              value={newModelName}
              onChange={(e) => setNewModelName(e.target.value)}
              placeholder="Tên model (tuỳ chọn)"
              maxLength={100}
            />
            <div className="model-row">
              <button type="submit" className="btn btn-small" disabled={!newModelFile || uploadProgress != null}>
                {uploadProgress != null ? (uploadProgress < 100 ? `Đang tải ${uploadProgress}%` : "Đang đọc model...") : "Tải lên"}
              </button>
              {models.length > 0 && (
                <button type="button" className="btn btn-small" onClick={() => setAdding(false)} disabled={uploadProgress != null}>
                  Huỷ
                </button>
              )}
            </div>
            <p className="eval-help">File trọng số Ultralytics (YOLO) dạng .pt hoặc .onnx.</p>
          </form>
        )}
      </div>

      {/* ---------- 2. Lớp ---------- */}
      {model && !adding && (
        <div className="eval-step">
          <div className="eval-step-title">
            2. Lớp được tính là người sử dụng laptop
            <span className="muted"> · {classes.length ? `${classes.length} lớp` : "mọi lớp"}</span>
          </div>
          <div className={classNames.length > 6 ? "class-list scroll" : "class-list"}>
            {classNames.map((c) => (
              <label key={c} className="class-option">
                <input type="checkbox" checked={classes.includes(c)} onChange={() => toggleClass(c)} disabled={running} />
                {c}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ---------- 3. Chạy ---------- */}
      <form className="eval-step" onSubmit={start}>
        <div className="eval-step-title">3. Chạy</div>
        <label className="eval-field">
          <span>Tên lượt (tuỳ chọn)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: yolo-v3 ngưỡng 0.5" maxLength={120} />
        </label>
        <ParamsFields params={params} onChange={setParam} />
        {running ? (
          <div className="job-progress" role="status">
            <div className="meter-track">
              <span className="meter-fill" style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </div>
            <span>
              {Math.round(job.progress * 100)}% · {job.message ?? "Đang chạy..."}
            </span>
          </div>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!FAKE_EVALUATION && (!model || adding)}>
            ▶ Chạy đánh giá
          </button>
        )}
      </form>

      {error && <p className="eval-error">{error}</p>}
    </div>
  );
}
