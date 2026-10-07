import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getAnnotation,
  getAnnotationSummaries,
  getAutoLabel,
  listAutoLabelModels,
  getUpload,
  runAutoLabel,
  retryProxy,
  listProjects,
  listUploads,
  saveAnnotation,
  videoUrl,
} from "../api/client.js";
import AnnotationCanvas from "../components/labeling/AnnotationCanvas.jsx";
import FrameScrubber from "../components/labeling/FrameScrubber.jsx";
import EventList from "../components/labeling/EventList.jsx";
import VideoTree, { labelStatus } from "../components/labeling/VideoTree.jsx";
import GtPreviewPanel from "../components/labeling/GtPreviewPanel.jsx";
import { CASES, trackColor } from "../labeling/constants.js";
import { readProjectChoice, writeProjectChoice } from "../projectChoice.js";
import {
  boxAt,
  createEventTrack,
  deleteKeyframe,
  endSegmentAt,
  neighborKeyframe,
  nextTrackId,
  renumberTracks,
  segmentAt,
  setKeyframe,
  setSegmentBounds,
  startSegmentAt,
} from "../labeling/tracks.js";
import "./LabelingPage.css";

const FALLBACK_FPS = 25;
const PROXY_POLL_MS = 3000;
const AUTOLABEL_POLL_MS = 2000;
const AUTOLABEL_MODEL_KEY = "labeling.autolabelModel";

function readAutoLabelModel() {
  try {
    return localStorage.getItem(AUTOLABEL_MODEL_KEY);
  } catch {
    return null;
  }
}

function writeAutoLabelModel(model) {
  try {
    localStorage.setItem(AUTOLABEL_MODEL_KEY, model);
  } catch {
    // Trình duyệt chặn localStorage thì chỉ không nhớ được model đã chọn
  }
}
const AUTOSAVE_DELAY = 800;
const BIG_STEP = 10;
// Tạm ẩn cột bên phải (danh sách người, case). Đổi thành true để hiện lại.
const SHOW_SIDE_PANEL = false;

const EMPTY_ANNOTATION = { tracks: [], case: null, done: false };

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function formatDuration(seconds) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const describeSegments = (track) =>
  track.segments.map((s) => `${s.start}–${s.end ?? "hết"}`).join(", ");

const isTyping = (target) => ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);

const LIST_HIDDEN_KEY = "labeling.listHidden";

function readListHidden() {
  try {
    return localStorage.getItem(LIST_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeListHidden(hidden) {
  try {
    localStorage.setItem(LIST_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    // Trình duyệt chặn localStorage thì chỉ không nhớ được lựa chọn
  }
}

export default function LabelingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const videoId = searchParams.get("video");

  const [uploads, setUploads] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [projects, setProjects] = useState([]);
  // ?project=<id> (nút "Gán nhãn" ở trang Tải dữ liệu) chọn sẵn project; không có thì dùng project lần trước
  const [projectChoice, setProjectChoice] = useState(() => searchParams.get("project") ?? readProjectChoice());
  useEffect(() => {
    const fromUrl = searchParams.get("project");
    if (fromUrl) writeProjectChoice(fromUrl);
  }, [searchParams]);
  const [listError, setListError] = useState("");
  const [listHidden, setListHidden] = useState(readListHidden);
  const [showGt, setShowGt] = useState(false);

  const [video, setVideo] = useState(null);
  const [annotation, setAnnotation] = useState(EMPTY_ANNOTATION);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [playError, setPlayError] = useState(false);
  // Trạng thái auto label của video đang mở: { status, progress, message, error, track_count }
  const [autoJob, setAutoJob] = useState(null);
  // Model dùng cho auto label (YOLO26s, YOLO26x...), danh sách lấy từ máy chủ
  const [autoModels, setAutoModels] = useState([]);
  const [savedAutoModel, setSavedAutoModel] = useState(readAutoLabelModel);
  const autoModel = autoModels.find((m) => m.id === savedAutoModel) ?? autoModels[0] ?? null;
  const autoModelName = (id) => autoModels.find((m) => m.id === id)?.name ?? id;

  useEffect(() => {
    listAutoLabelModels()
      .then(setAutoModels)
      .catch(() => setAutoModels([]));
  }, []);

  const chooseAutoModel = (id) => {
    setSavedAutoModel(id);
    writeAutoLabelModel(id);
  };

  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [hint, setHint] = useState("");
  // Sự kiện đang đánh dấu bằng phím Space: { start }. Mỗi sự kiện là một người mới.
  const [recording, setRecording] = useState(null);

  const [saveState, setSaveState] = useState("saved");
  const [saveError, setSaveError] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const [saveTick, setSaveTick] = useState(0);

  const videoRef = useRef(null);
  // Alt được bấm riêng (không kèm phím khác) thì khi thả mới nhảy đầu / cuối sự kiện
  const altAloneRef = useRef(false);
  const annotationRef = useRef(annotation);
  const versionRef = useRef(0);
  const savingRef = useRef(false);

  annotationRef.current = annotation;

  const fps = video?.fps || FALLBACK_FPS;
  const totalFrames = Math.max(1, Math.floor((duration || video?.duration || 0) * fps));
  const { tracks } = annotation;
  const selectedTrack = tracks.find((t) => t.track_id === selectedTrackId) ?? null;

  // Box hiển thị ở frame hiện tại, nội suy từ các keyframe
  const boxes = useMemo(
    () =>
      tracks
        .map((track) => {
          const box = boxAt(track, currentFrame);
          return (
            box && {
              ...box,
              id: track.track_id,
              track_id: track.track_id,
              color: trackColor(track.track_id),
              auto: track.confirmed === false,
            }
          );
        })
        .filter(Boolean),
    [tracks, currentFrame]
  );

  // ---------- Tải danh sách video ----------
  const refreshList = useCallback(() => {
    Promise.all([listUploads(), getAnnotationSummaries(), listProjects()])
      .then(([list, summary, projectList]) => {
        setUploads(list);
        setSummaries(summary);
        setProjects(projectList);
      })
      .catch((error) => setListError(error.message));
  }, []);

  useEffect(refreshList, [refreshList]);

  // ---------- Tải video và nhãn đang chọn ----------
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setVideo(null);
    setPlayError(false);
    setAnnotation(EMPTY_ANNOTATION);
    setCurrentFrame(0);
    setSelectedTrackId(null);
    setRecording(null);
    setDuration(0);
    setSaveState("saved");
    setSavedAt(null);
    setAutoJob(null);

    Promise.all([getUpload(videoId), getAnnotation(videoId), getAutoLabel(videoId)])
      .then(([upload, saved, job]) => {
        if (cancelled) return;
        setVideo(upload);
        setAnnotation({ tracks: saved.tracks, case: saved.case, done: saved.done });
        setSavedAt(saved.updated_at);
        setAutoJob(job);
      })
      .catch((error) => !cancelled && setLoadError(error.message))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // Video trình duyệt không phát được (ví dụ .avi) đang được backend chuyển sang MP4
  const proxyStatus = video?.proxy_status;
  const playable = Boolean(video) && (!proxyStatus || proxyStatus === "ready");

  useEffect(() => {
    if (proxyStatus !== "processing") return;
    const timer = setInterval(() => {
      getUpload(videoId)
        .then((upload) => {
          if (upload.proxy_status === "processing") return;
          setVideo(upload);
          setUploads((prev) => prev.map((u) => (u.id === upload.id ? upload : u)));
        })
        .catch(() => {});
    }, PROXY_POLL_MS);
    return () => clearInterval(timer);
  }, [proxyStatus, videoId]);

  const retryConversion = () =>
    retryProxy(videoId).then(setVideo, (error) => setVideo((v) => ({ ...v, proxy_error: error.message })));

  // ---------- Tự động lưu ----------
  const toPayload = (a) => ({ tracks: a.tracks, case: a.case, done: a.done });

  useEffect(() => {
    if (saveState !== "dirty" || savingRef.current || !videoId) return;
    const timer = setTimeout(async () => {
      savingRef.current = true;
      const version = versionRef.current;
      setSaveState("saving");
      try {
        const saved = await saveAnnotation(videoId, toPayload(annotationRef.current));
        setSavedAt(saved.updated_at);
        setSaveState(versionRef.current === version ? "saved" : "dirty");
        setSummaries((prev) => ({
          ...prev,
          [videoId]: {
            track_count: saved.tracks.length,
            case: saved.case,
            done: saved.done,
            auto_pending: saved.tracks.filter((t) => t.confirmed === false).length,
            updated_at: saved.updated_at,
          },
        }));
      } catch (error) {
        setSaveError(error.message);
        setSaveState("error");
      } finally {
        savingRef.current = false;
        setSaveTick((t) => t + 1);
      }
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [annotation, saveState, saveTick, videoId]);

  useEffect(() => {
    const warn = (event) => {
      if (saveState !== "saved") event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  const changeAnnotation = (updater) => {
    versionRef.current += 1;
    setAnnotation(updater);
    setSaveState((state) => (state === "saving" ? state : "dirty"));
  };

  // Người gán sửa track do auto label tạo thì coi như đã xem và xác nhận track đó
  const updateTrack = (trackId, updater) =>
    changeAnnotation((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.track_id === trackId ? { ...updater(t), ...(t.confirmed === false ? { confirmed: true } : {}) } : t
      ),
    }));

  const acceptTracks = (trackIds) =>
    changeAnnotation((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (trackIds.includes(t.track_id) ? { ...t, confirmed: true } : t)),
    }));

  // ---------- Điều khiển video ----------
  const seekToFrame = useCallback(
    (frame) => {
      const target = Math.min(totalFrames - 1, Math.max(0, frame));
      const element = videoRef.current;
      if (element) {
        element.pause();
        element.currentTime = (target + 0.5) / fps;
      }
      setCurrentFrame(target);
      setHint("");
    },
    [fps, totalFrames]
  );

  const togglePlay = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.paused) element.play();
    else {
      element.pause();
      seekToFrame(Math.floor(element.currentTime * fps));
    }
  }, [fps, seekToFrame]);

  useEffect(() => {
    if (!playing) return;
    let handle;
    const tick = () => {
      const element = videoRef.current;
      if (element) setCurrentFrame(Math.min(totalFrames - 1, Math.floor(element.currentTime * fps)));
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, fps, totalFrames]);

  // ---------- Thao tác với track ----------
  // Box vẽ ra luôn thuộc sự kiện đang chọn, và chỉ vẽ được trong khoảng thời gian của sự kiện đó.
  // Người mới chỉ tạo bằng phím Space.
  const drawMode = !selectedTrack ? "none" : segmentAt(selectedTrack, currentFrame) ? "draw" : "outside";

  const handleCreate = (rect) => {
    if (drawMode === "none") {
      setHint("Chọn một sự kiện trước (trên thanh trượt, danh sách Sự kiện hoặc bấm vào box), hoặc bấm Space để tạo sự kiện mới.");
      return;
    }
    if (drawMode === "outside") {
      setHint(`Frame ${currentFrame} nằm ngoài sự kiện #${selectedTrack.track_id}. Bấm Alt để về đầu sự kiện.`);
      return;
    }
    // Đã có box ở frame này thì vẽ lại sẽ thay box đó
    updateTrack(selectedTrack.track_id, (t) => setKeyframe(t, currentFrame, rect));
  };

  const handleMove = (trackId, changes) =>
    updateTrack(trackId, (t) => setKeyframe(t, currentFrame, { ...boxAt(t, currentFrame), ...changes }));

  const withSelected = (action) => {
    if (!selectedTrack) {
      setHint("Chọn một người trên video hoặc trên thanh thời gian trước.");
      return;
    }
    action(selectedTrack);
  };

  const startHere = () =>
    withSelected((t) => {
      const updated = startSegmentAt(t, currentFrame);
      if (updated === t) setHint(`Người #${t.track_id} không có đoạn nào ở sau frame này để kéo về.`);
      else updateTrack(t.track_id, () => updated);
    });

  const endHere = () =>
    withSelected((t) => {
      if (!segmentAt(t, currentFrame)) {
        setHint(`Người #${t.track_id} không có mặt ở frame ${currentFrame}.`);
        return;
      }
      updateTrack(t.track_id, (track) => endSegmentAt(track, currentFrame));
    });

  const pinHere = () =>
    withSelected((t) => {
      const box = boxAt(t, currentFrame);
      if (box) updateTrack(t.track_id, (track) => setKeyframe(track, currentFrame, box));
    });

  const deleteKeyframeHere = () =>
    withSelected((t) => {
      if (!t.keyframes[currentFrame]) {
        setHint(`Frame ${currentFrame} không phải keyframe của người #${t.track_id}.`);
      } else {
        updateTrack(t.track_id, (track) => deleteKeyframe(track, currentFrame));
      }
    });

  // Space lần 1 bắt đầu sự kiện (video vẫn phát tiếp), lần 2 kết thúc và dừng video tại đó.
  // Mỗi sự kiện luôn là một người mới.
  const toggleEvent = () => {
    if (!recording) {
      setRecording({ start: currentFrame });
      setHint("");
      return;
    }
    const start = Math.min(recording.start, currentFrame);
    const end = Math.max(recording.start, currentFrame);
    const track = createEventTrack(tracks, start, end);
    changeAnnotation((prev) => ({ ...prev, tracks: [...prev.tracks, track] }));
    setSelectedTrackId(track.track_id);
    setRecording(null);
    seekToFrame(currentFrame);
  };

  const nextEventTrackId = nextTrackId(tracks);

  const deleteTrack = (trackId, { confirm = true } = {}) => {
    if (confirm && !window.confirm(`Xoá người #${trackId} ở mọi frame?`)) return;
    // Đánh số lại liên tục sau khi xoá, màu đổi theo số mới
    const { tracks: renumbered, idMap } = renumberTracks(tracks.filter((t) => t.track_id !== trackId));
    changeAnnotation((prev) => ({ ...prev, tracks: renumbered }));
    setSelectedTrackId(selectedTrackId === trackId ? null : idMap.get(selectedTrackId) ?? null);
  };

  // Alt: nhảy giữa đầu và cuối sự kiện đang chọn để vẽ box ở hai đầu, phần giữa tự nội suy
  const jumpEventEdge = () =>
    withSelected((t) => {
      const segment = segmentAt(t, currentFrame) ?? t.segments[0];
      const end = Math.min(segment.end ?? totalFrames - 1, totalFrames - 1);
      const toEnd = currentFrame === segment.start && end !== segment.start;
      const target = toEnd ? end : segment.start;
      seekToFrame(target);
      setHint(
        toEnd
          ? `Cuối sự kiện #${t.track_id} (frame ${target}). Vẽ box quanh người, Alt để về đầu.`
          : `Đầu sự kiện #${t.track_id} (frame ${target}). Vẽ box quanh người, rồi Alt để xuống cuối.`
      );
    });

  const jumpKeyframe = (direction) =>
    withSelected((t) => {
      const frame = neighborKeyframe(t, currentFrame, direction);
      if (frame != null) seekToFrame(frame);
    });

  // Lưu ngay nhãn của video đang mở trước khi chuyển sang video hoặc project khác
  const saveBeforeLeaving = () => {
    if (videoId && saveState !== "saved") {
      saveAnnotation(videoId, toPayload(annotationRef.current)).then(refreshList, (error) =>
        setListError(`Không lưu được nhãn trước khi chuyển video: ${error.message}`)
      );
    }
  };

  const selectVideo = (id) => {
    if (id === videoId) return;
    saveBeforeLeaving();
    setSearchParams({ video: id });
  };

  // Gán nhãn theo từng project: chỉ hiện video của project đang chọn
  const project = projects.find((p) => p.id === projectChoice) ?? projects[0] ?? null;
  const projectUploads = project ? uploads.filter((u) => u.project_id === project.id) : [];
  const completeCount = projectUploads.filter((u) =>
    ["done", "empty"].includes(labelStatus(u, summaries[u.id]))
  ).length;
  const completePercent = projectUploads.length ? Math.round((completeCount / projectUploads.length) * 100) : 0;
  // Mọi video của project đã gán xong thì hiện nút chuyển sang trang Đánh giá
  const allLabeled = projectUploads.length > 0 && completeCount === projectUploads.length;

  const selectProject = (projectId) => {
    if (projectId === project?.id) return;
    saveBeforeLeaving();
    setProjectChoice(projectId);
    writeProjectChoice(projectId);
    setSearchParams({});
  };

  // Mở thẳng một video (ví dụ link ?video=...) thuộc project khác thì chuyển sang project đó
  const activeProjectId = uploads.find((u) => u.id === videoId)?.project_id;
  useEffect(() => {
    if (activeProjectId && activeProjectId !== projectChoice) {
      setProjectChoice(activeProjectId);
      writeProjectChoice(activeProjectId);
    }
  }, [activeProjectId, projectChoice]);

  // Người gán tự đánh dấu đã gán xong, để phân biệt video đang gán với video đã xong
  // Hoàn thành mà không có event là hợp lệ (video không có người dùng laptop); chỉ nhắc khi
  // video được phân loại là có người sử dụng
  const toggleDone = () => {
    if (!annotation.done) {
      const openTracks = tracks.filter((t) => t.segments.some((s) => s.end === null));
      const pendingAuto = tracks.filter((t) => t.confirmed === false);
      const warning =
        tracks.length === 0
          ? video.group === "using"
            ? "Video được phân loại là có người sử dụng nhưng chưa có event nào."
            : ""
          : pendingAuto.length > 0
            ? `Còn ${pendingAuto.length} người do auto label đề xuất chưa được chấp nhận.`
            : openTracks.length > 0
              ? `Người ${openTracks.map((t) => `#${t.track_id}`).join(", ")} còn đoạn chưa kết thúc.`
              : "";
      if (warning && !window.confirm(`${warning} Vẫn đánh dấu đã gán xong?`)) return;
    }
    changeAnnotation((prev) => ({ ...prev, done: !prev.done }));
  };

  // ---------- Auto label ----------
  const autoRunning = autoJob?.status === "queued" || autoJob?.status === "running";

  const reloadAnnotation = () =>
    getAnnotation(videoId).then((saved) => {
      versionRef.current += 1;
      setAnnotation({ tracks: saved.tracks, case: saved.case, done: saved.done });
      setSavedAt(saved.updated_at);
      setSaveState("saved");
      setSelectedTrackId(null);
      refreshList();
    });

  const startAutoLabel = async () => {
    if (saveState !== "saved") {
      setHint("Đang lưu nhãn, đợi lưu xong rồi bấm Auto label lại.");
      return;
    }
    if (tracks.some((t) => t.confirmed !== false)) {
      setHint("Video đã có nhãn do người gán nên không chạy auto label. Auto label chỉ chạy trên video chưa gán.");
      return;
    }
    if (tracks.length > 0 && !window.confirm("Kết quả auto label chưa xác nhận hiện tại sẽ được thay bằng kết quả mới. Chạy lại?")) {
      return;
    }
    try {
      setAutoJob(await runAutoLabel(videoId, autoModel?.id));
      setHint("");
    } catch (error) {
      setHint(`Không chạy được auto label: ${error.message}`);
    }
  };

  // Hỏi tiến độ định kỳ khi đang chạy; xong thì tải lại nhãn để hiện các người model đề xuất
  useEffect(() => {
    if (!autoRunning) return;
    const timer = setInterval(() => {
      getAutoLabel(videoId)
        .then((job) => {
          setAutoJob(job);
          if (job.status === "done") {
            reloadAnnotation();
            const by = job.model ? ` (${autoModelName(job.model)})` : "";
            setHint(
              job.track_count > 0
                ? `Auto label${by} đề xuất ${job.track_count} người. Xem lại từng người, sửa nếu cần rồi bấm Chấp nhận (phím A).`
                : `Auto label${by} không tìm thấy ai đang sử dụng máy tính trong video này.`
            );
          } else if (job.status === "error") {
            setHint(`Auto label bị lỗi: ${job.error}`);
          }
        })
        .catch(() => {});
    }, AUTOLABEL_POLL_MS);
    return () => clearInterval(timer);
  }, [autoRunning, videoId]);

  // ---------- Phím tắt ----------
  useEffect(() => {
    const onKeyDown = (event) => {
      // Đang auto label thì khoá sửa nhãn, tránh ghi đè lẫn nhau với kết quả của model
      if (!playable || autoRunning || isTyping(event.target)) return;
      const key = event.key;

      if (key === "Alt") {
        event.preventDefault();
        if (!event.repeat) altAloneRef.current = true;
        return;
      }
      altAloneRef.current = false;

      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "s") {
        event.preventDefault();
        setSaveState("dirty");
        setSaveTick((t) => t + 1);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const step = event.shiftKey ? BIG_STEP : 1;
      const lower = key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        if (!event.repeat) toggleEvent();
      } else if (lower === "p") {
        togglePlay();
      } else if (key === "ArrowRight") {
        event.preventDefault();
        seekToFrame(currentFrame + step);
      } else if (key === "ArrowLeft") {
        event.preventDefault();
        seekToFrame(currentFrame - step);
      } else if (key === "[") {
        jumpKeyframe(-1);
      } else if (key === "]") {
        jumpKeyframe(1);
      } else if (lower === "i") {
        startHere();
      } else if (lower === "o") {
        endHere();
      } else if (lower === "k") {
        pinHere();
      } else if (lower === "a") {
        withSelected((t) => acceptTracks([t.track_id]));
      } else if (key === "Delete" || key === "Backspace") {
        if (event.shiftKey) withSelected((t) => deleteTrack(t.track_id));
        else deleteKeyframeHere();
      } else if (key === "Enter") {
        // Chặn Enter kích hoạt nút đang được focus
        event.preventDefault();
        if (!event.repeat) toggleDone();
      } else if (key === "Escape") {
        if (recording) setRecording(null);
        else setSelectedTrackId(null);
        setHint("");
      }
    };
    const onKeyUp = (event) => {
      if (!playable || isTyping(event.target)) return;
      // Chặn Space kích hoạt nút đang được focus
      if (event.key === " ") event.preventDefault();
      // Chặn trình duyệt chuyển focus lên menu khi thả Alt
      if (event.key === "Alt") {
        event.preventDefault();
        if (altAloneRef.current) jumpEventEdge();
        altAloneRef.current = false;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  // ---------- Giao diện ----------
  const aspect = video?.width && video?.height ? video.width / video.height : 16 / 9;
  // Chưa chọn video thì luôn hiện danh sách để người dùng chọn
  const showList = !listHidden || !videoId;

  const toggleList = () => {
    setListHidden(showList);
    writeListHidden(showList);
  };

  const drawHint = recording
    ? `Đang đánh dấu người #${nextEventTrackId} từ frame ${recording.start}. Bấm Space để kết thúc (video sẽ dừng), Esc để huỷ.`
    : playing
      ? "Đang phát (P để dừng). Bấm Space khi người bắt đầu dùng laptop, Space lần nữa khi họ ngừng."
      : drawMode === "none"
        ? tracks.length === 0
          ? "Phát video (P), bấm Space khi người bắt đầu dùng laptop và Space lần nữa khi họ ngừng."
          : "Chọn một sự kiện để gán box, hoặc bấm Space để tạo sự kiện mới."
        : drawMode === "outside"
          ? `Frame ${currentFrame} nằm ngoài sự kiện #${selectedTrack.track_id}. Bấm Alt để về đầu sự kiện.`
          : boxAt(selectedTrack, currentFrame)
            ? `Sự kiện #${selectedTrack.track_id}: kéo box để chỉnh, vẽ lại để thay. Alt để nhảy đầu / cuối sự kiện.`
            : `Sự kiện #${selectedTrack.track_id} chưa có box ở đây. Kéo chuột quanh người để vẽ. Alt để nhảy đầu / cuối sự kiện.`;

  const drawColor = selectedTrack ? trackColor(selectedTrack.track_id) : "#ffffff";

  return (
    <section className={showGt && video ? "labeling-page gt-open" : "labeling-page"}>
      <div className="labeling-heading">
        <h1 className="page-title">Gán nhãn</h1>
        {allLabeled && (
          <button
            type="button"
            className="btn btn-primary labeling-evaluate"
            onClick={() => {
              saveBeforeLeaving();
              navigate(`/evaluation?project=${encodeURIComponent(project.id)}`);
            }}
          >
            Đánh giá →
          </button>
        )}
      </div>

      <div className={`labeling-layout${showList ? "" : " list-hidden"}${SHOW_SIDE_PANEL ? "" : " no-side"}`}>
        <aside className="card labeling-videos" hidden={!showList}>
          {projects.length > 0 ? (
            // Chọn project ngay đầu danh sách video, bên dưới là thanh tiến độ gán nhãn của project
            <div className="panel-header panel-header-project">
              <select
                value={project?.id ?? ""}
                onChange={(e) => selectProject(e.target.value)}
                aria-label="Project"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {projectUploads.length > 0 && (
                // Tiến độ gán nhãn của project đang chọn
                <div className="label-progress" title={`Đã gán xong ${completeCount}/${projectUploads.length} video`}>
                  <div className="label-progress-head">
                    <span>Tiến độ gán nhãn</span>
                    <span>
                      {completeCount}/{projectUploads.length} · {completePercent}%
                    </span>
                  </div>
                  <div
                    className="label-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={completePercent}
                    aria-label="Tiến độ gán nhãn"
                  >
                    <span className="label-progress-fill" style={{ width: `${completePercent}%` }} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="panel-header">Video · {projectUploads.length}</div>
          )}
          {listError && <p className="panel-error">{listError}</p>}
          {projectUploads.length === 0 && !listError ? (
            <p className="panel-empty">
              {project
                ? "Project này chưa có video. Hãy tải video vào project ở trang Tải dữ liệu."
                : "Chưa có project. Hãy tạo project và tải video ở trang Tải dữ liệu."}
            </p>
          ) : (
            <VideoTree
              uploads={projectUploads}
              summaries={summaries}
              activeId={videoId}
              onSelect={selectVideo}
            />
          )}
        </aside>

        <div className="labeling-main">
          {!videoId ? (
            <div className="card labeling-placeholder">Chọn một video ở danh sách bên trái để bắt đầu gán nhãn.</div>
          ) : loadError ? (
            <div className="card labeling-placeholder panel-error">Không mở được video: {loadError}</div>
          ) : loading || !video ? (
            <div className="card labeling-placeholder">Đang tải video...</div>
          ) : proxyStatus === "processing" ? (
            <div className="card labeling-placeholder">
              <p className="proxy-title">Đang chuyển video sang định dạng xem được trên trình duyệt...</p>
              <p>
                {video.name} ({video.codec ?? "không rõ codec"}) không phát trực tiếp được. Video khoảng 7 phút thường
                mất khoảng 1 phút. Trang sẽ tự mở video khi xong, số frame giữ nguyên như file gốc.
              </p>
            </div>
          ) : proxyStatus === "error" ? (
            <div className="card labeling-placeholder">
              <p className="proxy-title panel-error">Không chuyển được định dạng video.</p>
              <p>{video.proxy_error}</p>
              <button type="button" className="btn btn-small" onClick={retryConversion}>
                Thử lại
              </button>
            </div>
          ) : (
            <>
              <div className="labeling-toolbar">
                {/* Nút danh sách và nút auto label đứng sát nhau ở đầu thanh công cụ */}
                <div className="toolbar-group">
                  <button
                    type="button"
                    className="tool-button"
                    onClick={toggleList}
                    aria-pressed={showList}
                    title={showList ? "Ẩn danh sách video để khung video rộng hơn" : "Hiện danh sách video"}
                  >
                    {showList ? "◀ Ẩn danh sách" : "▶ Danh sách video"}
                  </button>
                  <button
                    type="button"
                    className={autoRunning ? "tool-button autolabel-button running" : "tool-button autolabel-button"}
                    onClick={startAutoLabel}
                    disabled={autoRunning}
                    title="Model tự đề xuất người đang sử dụng laptop. Kết quả cần được xem lại và chấp nhận"
                    style={autoRunning ? { "--progress": `${Math.round((autoJob.progress ?? 0) * 100)}%` } : undefined}
                  >
                    {autoJob?.status === "queued"
                      ? "✨ Đang chờ..."
                      : autoJob?.status === "running"
                        ? `✨ ${autoModelName(autoJob.model)} ${Math.round((autoJob.progress ?? 0) * 100)}%`
                        : "✨ Auto label"}
                  </button>
                  {autoModels.length > 1 && (
                    <select
                      className="autolabel-model"
                      value={autoModel?.id ?? ""}
                      onChange={(e) => chooseAutoModel(e.target.value)}
                      disabled={autoRunning}
                      aria-label="Model dùng cho auto label"
                      title={autoModel?.note}
                    >
                      {autoModels.map((m) => (
                        <option key={m.id} value={m.id} title={m.note}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {selectedTrack && (
                  <div className="track-actions" role="group" aria-label={`Người #${selectedTrack.track_id}`}>
                    <span className="track-actions-name">
                      <span className="tool-swatch" style={{ background: trackColor(selectedTrack.track_id) }} />
                      Người #{selectedTrack.track_id}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  className="tool-button"
                  onClick={() => setShowGt((open) => !open)}
                  aria-pressed={showGt}
                  title="Xem phần GT của video này, dựng từ nhãn đã lưu"
                >
                  Ground truth
                </button>
                {!SHOW_SIDE_PANEL && (
                  <SaveStatus
                    state={saveState}
                    error={saveError}
                    savedAt={savedAt}
                    onRetry={() => setSaveState("dirty")}
                  />
                )}
              </div>

              <div className="video-stage-wrap">
                <div
                  className="video-stage"
                  style={{ aspectRatio: aspect, width: `min(100%, calc(62vh * ${aspect}))` }}
                >
                  <video
                    ref={videoRef}
                    src={videoUrl(video.id)}
                    preload="auto"
                    muted
                    playsInline
                    onLoadedMetadata={(e) => {
                      setDuration(e.currentTarget.duration);
                      // ?frame=<số> (mở từ danh sách lỗi ở trang Đánh giá model) thì tua tới frame đó
                      const startFrame = Math.max(0, Math.floor(Number(searchParams.get("frame")) || 0));
                      e.currentTarget.currentTime = (startFrame + 0.5) / fps;
                      if (startFrame) setCurrentFrame(startFrame);
                    }}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onError={() => setPlayError(true)}
                  />
                  {playError && (
                    <div className="video-play-error">
                      Trình duyệt không phát được video này ({video.codec ?? "không rõ codec"}). Hãy chuyển sang MP4
                      (H.264) rồi tải lên lại.
                    </div>
                  )}
                  <AnnotationCanvas
                    boxes={boxes}
                    selectedId={selectedTrackId}
                    draftColor={drawColor}
                    disabled={playing || autoRunning}
                    onSelect={setSelectedTrackId}
                    onCreate={handleCreate}
                    onUpdate={handleMove}
                  />
                </div>
              </div>

              <FrameScrubber
                totalFrames={totalFrames}
                currentFrame={currentFrame}
                fps={fps}
                tracks={tracks}
                selectedTrackId={selectedTrackId}
                recording={recording && { start: recording.start, color: trackColor(nextEventTrackId) }}
                onSeek={seekToFrame}
                onSelect={setSelectedTrackId}
                onChangeSegment={(trackId, index, start, end) =>
                  updateTrack(trackId, (t) => setSegmentBounds(t, index, start, end))
                }
              />

              <div className="playback">
                <button type="button" className="icon-button" onClick={() => seekToFrame(currentFrame - 1)} title="Lùi 1 frame (←)">
                  ⏮
                </button>
                <button type="button" className="icon-button play" onClick={togglePlay} title="Phát / dừng (P)">
                  {playing ? "⏸" : "▶"}
                </button>
                <button type="button" className="icon-button" onClick={() => seekToFrame(currentFrame + 1)} title="Tới 1 frame (→)">
                  ⏭
                </button>
                <button
                  type="button"
                  className={recording ? "event-button recording" : "event-button"}
                  onClick={toggleEvent}
                  title="Phím Space"
                  style={{ "--event-color": trackColor(nextEventTrackId) }}
                >
                  {recording ? "■ Kết thúc sự kiện" : "● Bắt đầu sự kiện"}
                </button>
                <span className="frame-info">
                  Frame {currentFrame} / {totalFrames - 1} · {formatTime(currentFrame / fps)}
                </span>
              </div>

              <p className={hint ? "draw-hint warning" : "draw-hint"}>{hint || drawHint}</p>

              <EventList
                tracks={tracks}
                totalFrames={totalFrames}
                fps={fps}
                selectedTrackId={selectedTrackId}
                onSelect={setSelectedTrackId}
                onSeek={seekToFrame}
                onDelete={(trackId) => deleteTrack(trackId, { confirm: false })}
                onAccept={(trackId) => acceptTracks([trackId])}
                onAcceptAll={() => acceptTracks(tracks.filter((t) => t.confirmed === false).map((t) => t.track_id))}
              />

              {!video.fps && (
                <p className="panel-error">Không đọc được fps của video, đang tạm dùng {FALLBACK_FPS} fps.</p>
              )}

              <details className="shortcuts">
                <summary>Cách gán và phím tắt</summary>
                <dl>
                  <dt>Space</dt>
                  <dd>Bắt đầu / kết thúc sự kiện: mỗi sự kiện là một người mới dùng laptop. Bấm được khi video đang phát, kết thúc thì video tự dừng. Bắt nhầm thì bấm Xóa ở danh sách sự kiện</dd>
                  <dt>P</dt>
                  <dd>Phát / dừng video</dd>
                  <dt>Alt</dt>
                  <dd>Nhảy về đầu sự kiện đang chọn, bấm lần nữa để xuống cuối. Vẽ box ở hai đầu, các frame ở giữa tự nội suy</dd>
                  <dt>Kéo chuột</dt>
                  <dd>Vẽ box quanh người cho sự kiện đang chọn. Chọn sự kiện khác (trên thanh trượt, danh sách hoặc bấm vào box) để gán cho người khác</dd>
                  <dt>Kéo box</dt>
                  <dd>Kéo bên trong để di chuyển, kéo 4 góc để đổi kích thước. Box gán tay vẽ nét liền (◆), box nội suy giữa hai box gán tay vẽ nét đứt. Chỉnh box nét đứt thì nó thành box gán tay</dd>
                  <dt>Kéo hai đầu</dt>
                  <dd>Kéo mép trái / phải của dải màu trên thanh trượt frame để chỉnh thời gian bắt đầu / kết thúc. Video tua theo khi kéo</dd>
                  <dt>I / O</dt>
                  <dd>Bắt đầu / kết thúc đoạn xuất hiện của người đang chọn tại frame hiện tại</dd>
                  <dt>K</dt>
                  <dd>Ghim box nội suy tại frame này thành keyframe</dd>
                  <dt>[ ]</dt>
                  <dd>Nhảy tới keyframe trước / sau của người đang chọn</dd>
                  <dt>← →</dt>
                  <dd>Lùi / tới 1 frame (giữ Shift: {BIG_STEP} frame)</dd>
                  <dt>Delete</dt>
                  <dd>Xóa keyframe tại frame này (Shift + Delete: xóa cả người)</dd>
                  <dt>Esc</dt>
                  <dd>Huỷ sự kiện đang đánh dấu, hoặc bỏ chọn người để box vẽ tiếp theo là người mới</dd>
                  <dt>A</dt>
                  <dd>Chấp nhận người đang chọn do auto label đề xuất (sửa box hoặc đoạn của người đó cũng tính là chấp nhận)</dd>
                  <dt>Enter</dt>
                  <dd>Đánh dấu đã gán xong video này, bấm lần nữa để chuyển về đang gán. Không có event nào thì video được đánh dấu hoàn thành · không có event</dd>
                  <dt>Ctrl + S</dt>
                  <dd>Lưu ngay</dd>
                </dl>
              </details>
            </>
          )}
        </div>

        {SHOW_SIDE_PANEL && video && !loading && !loadError && (
          <aside className="card labeling-side">
            <section className="side-section">
              <div className="side-title">
                Người trong video
                <span className="side-count">{tracks.length}</span>
              </div>
              {tracks.length === 0 ? (
                <p className="panel-empty">{drawHint}</p>
              ) : (
                <ul className="box-list">
                  {tracks.map((track) => (
                    <li
                      key={track.track_id}
                      className={track.track_id === selectedTrackId ? "box-item selected" : "box-item"}
                      onClick={() => setSelectedTrackId(track.track_id)}
                    >
                      <div className="box-item-head">
                        <span className="tool-swatch" style={{ background: trackColor(track.track_id) }} />
                        <strong>Người #{track.track_id}</strong>
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteTrack(track.track_id);
                          }}
                        >
                          Xóa
                        </button>
                      </div>
                      <span className="box-item-detail">Frame {describeSegments(track)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="side-section">
              <div className="side-title">Case của video</div>
              <div className="case-row">
                <select
                  value={annotation.case ?? ""}
                  onChange={(e) => changeAnnotation((prev) => ({ ...prev, case: e.target.value || null }))}
                >
                  <option value="">Chưa chọn case</option>
                  {CASES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <SaveStatus
              state={saveState}
              error={saveError}
              savedAt={savedAt}
              onRetry={() => setSaveState("dirty")}
            />
          </aside>
        )}
      </div>
      {showGt && video && (
        <GtPreviewPanel
          videoId={video.id}
          savedAt={savedAt}
          unsaved={saveState !== "saved"}
          onSeek={seekToFrame}
          onClose={() => setShowGt(false)}
        />
      )}
    </section>
  );
}

function SaveStatus({ state, error, savedAt, onRetry }) {
  if (state === "error") {
    return (
      <p className="save-status error">
        Lưu thất bại: {error}
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Thử lại
        </button>
      </p>
    );
  }
}
