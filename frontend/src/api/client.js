const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

async function errorMessage(response) {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Body không phải JSON, dùng mã lỗi HTTP
  }
  return `Lỗi máy chủ (HTTP ${response.status})`;
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  return response.status === 204 ? null : response.json();
}

export const listUploads = () => request("/uploads");

export const deleteUpload = (id) => request(`/uploads/${id}`, { method: "DELETE" });

export const getUpload = (id) => request(`/uploads/${id}`);

export const retryProxy = (id) => request(`/uploads/${id}/proxy`, { method: "POST" });

export const videoUrl = (id) => `${BASE_URL}/uploads/${id}/video`;

export const getAnnotation = (id) => request(`/uploads/${id}/annotation`);

export const saveAnnotation = (id, annotation) =>
  request(`/uploads/${id}/annotation`, { method: "PUT", body: JSON.stringify(annotation) });

export const getAnnotationSummaries = () => request("/annotations/summary");

// Auto label chạy nền trên máy chủ: POST để bắt đầu, GET để xem tiến độ.
// model: id trong listAutoLabelModels (ví dụ "yolo26x.pt"); bỏ trống thì dùng model mặc định
export const runAutoLabel = (id, model) =>
  request(`/uploads/${id}/autolabel`, { method: "POST", body: JSON.stringify({ model: model || null }) });

export const listAutoLabelModels = () => request("/autolabel/models");

export const getAutoLabel = (id) => request(`/uploads/${id}/autolabel`);

// Project: bộ video do người dùng tự gom ở trang Tải dữ liệu
export const listProjects = () => request("/projects");

export const createProject = (name) => request("/projects", { method: "POST", body: JSON.stringify({ name }) });

export const renameProject = (id, name) =>
  request(`/projects/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });

// Xoá project cùng mọi video bên trong (file, bản xem, nhãn)
export const deleteProject = (id) => request(`/projects/${id}`, { method: "DELETE" });

// projectId = null để bỏ video khỏi project
export const moveToProject = (uploadIds, projectId) =>
  request("/uploads/project", {
    method: "POST",
    body: JSON.stringify({ upload_ids: uploadIds, project_id: projectId }),
  });

// group = null để đưa video về folder "Chưa phân loại"
export const classifyUploads = (uploadIds, group) =>
  request("/uploads/classify", {
    method: "POST",
    body: JSON.stringify({ upload_ids: uploadIds, group }),
  });

export const getGtPreview = (uploadId, frameStep) => request(`/gt/preview/${uploadId}?frame_step=${frameStep}`);

// Dùng XMLHttpRequest vì fetch chưa báo được tiến độ tải lên
export function uploadVideo(file, onProgress, { suggestedGroup, projectId } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/uploads`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Bỏ qua, xử lý bên dưới
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
      } else {
        reject(new Error(typeof body?.detail === "string" ? body.detail : `Lỗi máy chủ (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Không kết nối được máy chủ."));

    const form = new FormData();
    form.append("file", file);
    if (suggestedGroup) form.append("suggested_group", suggestedGroup);
    if (projectId) form.append("project_id", projectId);
    xhr.send(form);
  });
}

// ---------- Đánh giá model và báo cáo ----------
export const listEvaluations = (projectId) =>
  request(projectId ? `/evaluations?project_id=${encodeURIComponent(projectId)}` : "/evaluations");

export const getEvaluation = (id) => request(`/evaluations/${id}`);

// review: "unreviewed" | "label_error" | "model_error" | "not_error"
export const reviewEvaluationVideo = (id, uploadId, review, note) =>
  request(`/evaluations/${id}/videos/${uploadId}`, { method: "PATCH", body: JSON.stringify({ review, note }) });

export const updateEvaluationReport = (id, changes) =>
  request(`/evaluations/${id}/report`, { method: "PATCH", body: JSON.stringify(changes) });

export const deleteEvaluation = (id) => request(`/evaluations/${id}`, { method: "DELETE" });

export const evaluationDownloadUrl = (id) => `${BASE_URL}/evaluations/${id}/download`;

// Model để đánh giá: tải file trọng số (.pt / .onnx) lên, chạy qua video của project trong nền
export const listEvalModels = () => request("/eval-models");

export function uploadEvalModel(file, name, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/eval-models`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Bỏ qua, xử lý bên dưới
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(typeof body?.detail === "string" ? body.detail : `Lỗi máy chủ (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Không kết nối được máy chủ."));
    const form = new FormData();
    form.append("file", file);
    if (name) form.append("name", name);
    xhr.send(form);
  });
}

export const deleteEvalModel = (id) => request(`/eval-models/${id}`, { method: "DELETE" });

// body: { project_id, model_id, name, classes, params }
export const startModelEvaluation = (body) =>
  request("/evaluations/run", { method: "POST", body: JSON.stringify(body) });

export const listEvaluationJobs = (projectId) =>
  request(`/evaluations/jobs?project_id=${encodeURIComponent(projectId)}`);

export const getEvaluationJob = (id) => request(`/evaluations/jobs/${id}`);
