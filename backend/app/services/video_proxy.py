"""Tạo bản xem MP4 (H.264) cho video trình duyệt không phát được.

Ví dụ camera hay xuất .avi dạng MJPEG: server nhận và lưu bình thường nhưng thẻ
<video> của trình duyệt không phát được. Khi đó tạo thêm file <id>.play.mp4 chạy nền
và API /uploads/{id}/video trả file này thay cho file gốc. File gốc vẫn giữ nguyên.
"""

import shutil
import subprocess
import threading
from pathlib import Path

from app.schemas.upload import Upload
from app.services.upload_store import UploadStore

# Trình duyệt phổ biến chỉ phát ổn định các codec này trong vỏ mp4 / webm / mov
BROWSER_CODECS = {"h264", "vp8", "vp9", "av1"}
BROWSER_CONTAINERS = {".mp4", ".webm", ".mov"}

# Id các video đang chuyển đổi trong tiến trình này, để không chạy trùng hai lần một video
_running: set[str] = set()
_running_lock = threading.Lock()


class ProxyError(Exception):
    pass


def needs_proxy(upload: Upload) -> bool:
    container = Path(upload.stored_as).suffix.lower()
    return container not in BROWSER_CONTAINERS or (upload.codec is not None and upload.codec not in BROWSER_CODECS)


def proxy_path(upload_dir: Path, upload_id: str) -> Path:
    return upload_dir / f"{upload_id}.play.mp4"


def is_running(upload_id: str) -> bool:
    with _running_lock:
        return upload_id in _running


def make_proxy(source: Path, destination: Path, fps: float | None) -> None:
    """Chuyển video sang H.264 MP4 để phát trên trình duyệt.

    Giữ nguyên từng frame (fps_mode passthrough) để số thứ tự frame của nhãn vẫn khớp
    với file gốc. Mỗi giây một keyframe để tua từng frame không bị chậm.
    """
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise ProxyError("Máy chủ chưa cài ffmpeg nên không chuyển được định dạng video.")

    tmp_path = destination.with_name(destination.stem + ".tmp.mp4")
    result = subprocess.run(
        [
            ffmpeg, "-v", "error", "-y", "-i", str(source),
            "-map", "0:v:0", "-map", "0:a:0?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            # libx264 cần chiều rộng, chiều cao chẵn
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-g", str(max(1, round(fps or 25))),
            "-fps_mode", "passthrough",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        tmp_path.unlink(missing_ok=True)
        detail = result.stderr.strip().splitlines()[-1:] or ["không rõ lỗi"]
        raise ProxyError(f"Không chuyển được định dạng video: {detail[0]}")
    tmp_path.replace(destination)


def run_proxy_job(store: UploadStore, upload_id: str) -> None:
    """Tạo bản xem cho một video, chạy nền sau khi trả response. Bỏ qua nếu đang chạy."""
    with _running_lock:
        if upload_id in _running:
            return
        _running.add(upload_id)
    try:
        upload = store.get(upload_id)
        if upload is None:
            return
        destination = proxy_path(store.upload_dir, upload_id)
        try:
            make_proxy(store.upload_dir / upload.stored_as, destination, upload.fps)
            changes = {"proxy_status": "ready", "proxy_error": None}
        except ProxyError as error:
            changes = {"proxy_status": "error", "proxy_error": str(error)}

        # Đọc lại vì trong lúc chuyển đổi video có thể đã được phân loại hoặc bị xoá
        latest = store.get(upload_id)
        if latest is None:
            destination.unlink(missing_ok=True)
            return
        store.update(latest.model_copy(update=changes))
    finally:
        with _running_lock:
            _running.discard(upload_id)
