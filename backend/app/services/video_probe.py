"""Đọc metadata video (thời lượng, fps, kích thước, codec) bằng ffprobe của FFmpeg."""

import json
import shutil
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path


class InvalidVideoError(Exception):
    pass


@dataclass
class VideoInfo:
    duration: float | None = None
    fps: float | None = None
    width: int | None = None
    height: int | None = None
    codec: str | None = None


def _parse_rate(rate: str | None) -> float | None:
    """ffprobe trả fps dạng phân số, ví dụ "30000/1001" (29.97 fps)."""
    try:
        value = float(Fraction(rate))
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return value if value > 0 else None


def probe_video(path: Path) -> VideoInfo:
    """Đọc thời lượng, fps và kích thước video bằng ffprobe.

    Không có ffprobe trên máy thì trả VideoInfo rỗng. File không đọc được
    như video thì raise InvalidVideoError.
    """
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        return VideoInfo()

    result = subprocess.run(
        [
            ffprobe,
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate:format=duration",
            "-of", "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise InvalidVideoError("Không đọc được file video. File có thể bị hỏng hoặc sai định dạng.")

    info = json.loads(result.stdout or "{}")
    streams = info.get("streams") or []
    if not streams:
        raise InvalidVideoError("File không có luồng hình ảnh (video stream).")

    stream = streams[0]
    duration = info.get("format", {}).get("duration")
    return VideoInfo(
        duration=float(duration) if duration is not None else None,
        fps=_parse_rate(stream.get("avg_frame_rate")) or _parse_rate(stream.get("r_frame_rate")),
        width=stream.get("width"),
        height=stream.get("height"),
        codec=stream.get("codec_name"),
    )
