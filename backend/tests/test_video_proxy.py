import shutil
import subprocess

import pytest

from app.services import video_proxy
from app.services.video_probe import VideoInfo

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="Cần ffmpeg và ffprobe để tạo và đọc video thử",
)


def codec_and_frames(path):
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
            "-show_entries", "stream=codec_name,nb_read_frames", "-of", "csv=p=0", str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    codec, frames = result.stdout.strip().split(",")
    return codec, int(frames)


@pytest.fixture(scope="session")
def mjpeg_avi(tmp_path_factory):
    if shutil.which("ffmpeg") is None:
        pytest.skip("Cần ffmpeg để tạo video thử")
    path = tmp_path_factory.mktemp("videos") / "day_1.avi"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=66x50:rate=25",
            "-c:v", "mjpeg", str(path),
        ],
        check=True,
    )
    return path


def upload_avi(client, path):
    return client.post("/api/v1/uploads", files={"file": (path.name, path.read_bytes(), "video/x-msvideo")})


@needs_ffmpeg
def test_avi_gets_browser_playable_copy_with_same_frames(client, store, mjpeg_avi):
    response = upload_avi(client, mjpeg_avi)

    assert response.status_code == 201
    body = response.json()
    assert body["codec"] == "mjpeg"
    assert body["proxy_status"] == "processing"

    # TestClient chạy xong background task trước khi trả response
    assert store.get(body["id"]).proxy_status == "ready"
    proxy = store.upload_dir / f"{body['id']}.play.mp4"
    assert codec_and_frames(proxy) == ("h264", codec_and_frames(mjpeg_avi)[1])

    video = client.get(f"/api/v1/uploads/{body['id']}/video")
    assert video.headers["content-type"] == "video/mp4"
    assert len(video.content) == proxy.stat().st_size

    client.delete(f"/api/v1/uploads/{body['id']}")
    assert not proxy.exists()


@needs_ffmpeg
def test_mp4_h264_plays_directly(client, uploaded_video):
    assert uploaded_video["codec"] == "h264"
    assert uploaded_video["proxy_status"] is None
    assert client.post(f"/api/v1/uploads/{uploaded_video['id']}/proxy").status_code == 409


@needs_ffmpeg
def test_old_avi_without_copy_is_converted_when_opened(client, store, mjpeg_avi):
    body = upload_avi(client, mjpeg_avi).json()
    # Giả lập bản ghi cũ: tải lên trước khi có tính năng bản xem
    (store.upload_dir / f"{body['id']}.play.mp4").unlink()
    store.update(store.get(body["id"]).model_copy(update={"proxy_status": None, "codec": None}))

    client.get(f"/api/v1/uploads/{body['id']}")

    assert store.get(body["id"]).proxy_status == "ready"
    assert (store.upload_dir / f"{body['id']}.play.mp4").exists()


def test_failed_conversion_is_reported_and_can_retry(client, store, monkeypatch):
    def fail(*args):
        raise video_proxy.ProxyError("Không chuyển được định dạng video: lỗi thử")

    monkeypatch.setattr(video_proxy, "make_proxy", fail)
    monkeypatch.setattr(
        "app.api.v1.endpoints.uploads.probe_video",
        lambda path: VideoInfo(duration=1.0, fps=25.0, width=64, height=64, codec="mjpeg"),
    )

    body = client.post("/api/v1/uploads", files={"file": ("cam.avi", b"x", "video/x-msvideo")}).json()

    saved = store.get(body["id"])
    assert saved.proxy_status == "error"
    assert "lỗi thử" in saved.proxy_error

    monkeypatch.setattr(video_proxy, "make_proxy", lambda source, destination, fps: destination.write_bytes(b"ok"))
    client.post(f"/api/v1/uploads/{body['id']}/proxy")

    assert store.get(body["id"]).proxy_status == "ready"
