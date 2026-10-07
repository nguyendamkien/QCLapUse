// TẠM THỜI: số liệu giả lập cho phần "Đánh giá hiện tại", chưa chạy model thật.
// Đổi FAKE_EVALUATION thành false để quay lại chạy model trên máy chủ.
export const FAKE_EVALUATION = true;

const FALLBACK_FPS = 25;

const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const chance = (p) => Math.random() < p;
const ratio = (a, b) => (b ? a / b : null);

function boxMetrics(tp, fp, fn) {
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 =
    precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, precision, recall, f1 };
}

const sumBoxes = (videos) =>
  boxMetrics(
    videos.reduce((n, v) => n + v.box.tp, 0),
    videos.reduce((n, v) => n + v.box.fp, 0),
    videos.reduce((n, v) => n + v.box.fn, 0)
  );

// Video của project nếu đã phân loại; project chưa có video nào phân loại thì bịa vài video mẫu
function sourceVideos(uploads) {
  const classified = uploads.filter((u) => u.group);
  if (classified.length) return classified;
  return Array.from({ length: 12 }, (_, i) => ({
    id: `fake-video-${i + 1}`,
    name: `cam${String(i + 1).padStart(2, "0")}_mau.mp4`,
    group: i < 8 ? "using" : "not_using",
    duration: randInt(60, 420),
    fps: FALLBACK_FPS,
  }));
}

function errorFrames(count, lastFrame, step) {
  const frames = new Set();
  const slots = Math.max(1, Math.floor(lastFrame / step));
  while (frames.size < Math.min(count, slots)) frames.add(randInt(0, slots) * step);
  return [...frames].sort((a, b) => a - b);
}

function fakeVideo(upload, params) {
  const step = params.frame_step;
  const lastFrame = Math.max(step, Math.round((upload.duration || 60) * (upload.fps || FALLBACK_FPS)));
  const scored = Math.max(1, Math.floor(lastFrame / step));
  const using = upload.group === "using";

  let box;
  if (using) {
    // Phần lớn video nhận tốt, thỉnh thoảng một video bị sót nhiều
    const missedMost = chance(0.1);
    const truth = Math.max(1, Math.round(scored * (0.3 + Math.random() * 0.5)));
    const fn = missedMost ? Math.round(truth * 0.9) : Math.round(truth * Math.random() * 0.15);
    box = { tp: truth - fn, fp: chance(0.4) ? randInt(1, 6) : 0, fn };
  } else {
    box = { tp: 0, fp: chance(0.3) ? randInt(1, 8) : 0, fn: 0 };
  }

  const predictedUsing = box.tp + box.fp >= params.min_frames_video;
  const hasError = box.fp > 0 || box.fn > 0 || predictedUsing !== using;
  return {
    upload_id: upload.id,
    name: upload.name,
    group: upload.group,
    in_prediction_file: true,
    predicted_using: predictedUsing,
    box,
    error_frames: hasError ? errorFrames(box.fp + box.fn, lastFrame, step) : [],
    has_error: hasError,
    review: "unreviewed",
    note: null,
  };
}

// Dựng một lượt đánh giá giả có cùng dạng với lượt thật, để hiện bằng các tab Kết quả / Ca lỗi / Báo cáo
export function makeFakeRun({ modelName, classes, params, uploads, projectName }) {
  const videos = sourceVideos(uploads).map((u) => fakeVideo(u, params));
  const byGroup = (group) => videos.filter((v) => v.group === group);
  const actual = (v) => v.group === "using";
  const count = (fn) => videos.filter(fn).length;
  const video = {
    tp: count((v) => actual(v) && v.predicted_using),
    fn: count((v) => actual(v) && !v.predicted_using),
    fp: count((v) => !actual(v) && v.predicted_using),
    tn: count((v) => !actual(v) && !v.predicted_using),
  };
  video.accuracy = ratio(video.tp + video.tn, videos.length);

  return {
    id: `fake-${Date.now()}`,
    fake: true,
    name: "Lượt đánh giá hiện tại",
    project_name: projectName,
    model: modelName,
    classes: classes.length ? classes : null,
    source: "model",
    created_at: new Date().toISOString(),
    params,
    video_count: videos.length,
    error_video_count: count((v) => v.has_error),
    box: sumBoxes(videos),
    box_by_group: { using: sumBoxes(byGroup("using")), not_using: sumBoxes(byGroup("not_using")) },
    video,
    videos,
    skipped: [],
    unmatched_prediction_keys: [],
    report: { status: "draft", summary_note: null, approved_at: null },
  };
}

// Lượt giả không có trên máy chủ: phân loại lỗi và báo cáo chỉ sửa trong trang
export const fakeReview = (run, uploadId, review, note) => ({
  ...run,
  videos: run.videos.map((v) => (v.upload_id === uploadId ? { ...v, review, note: note.trim() || null } : v)),
});

export const fakeUpdateReport = (run, changes) => ({
  ...run,
  report: {
    ...run.report,
    ...changes,
    approved_at:
      changes.status === undefined
        ? run.report.approved_at
        : changes.status === "approved"
          ? new Date().toISOString()
          : null,
  },
});
