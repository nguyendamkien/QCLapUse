import shutil

import pytest

from app.core.config import settings

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="Cần ffmpeg và ffprobe để tạo và đọc video thử",
)


def upload(client, name, content):
    return client.post("/api/v1/uploads", files={"file": (name, content, "video/mp4")})


@needs_ffmpeg
def test_upload_saves_video_and_reads_duration(client, store, sample_video):
    response = upload(client, sample_video.name, sample_video.read_bytes())

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "cam03_2026-09-24.mp4"
    assert body["size"] == sample_video.stat().st_size
    assert body["duration"] == pytest.approx(1.0, abs=0.1)
    assert body["fps"] == pytest.approx(10)
    assert (body["width"], body["height"]) == (64, 64)
    assert (store.upload_dir / body["stored_as"]).exists()

    listed = client.get("/api/v1/uploads").json()
    assert [item["id"] for item in listed] == [body["id"]]


def test_upload_rejects_unsupported_extension(client, store):
    response = upload(client, "notes.txt", b"hello")

    assert response.status_code == 415
    assert list(store.upload_dir.iterdir()) == []


@needs_ffmpeg
def test_upload_rejects_file_that_is_not_a_video(client, store):
    response = upload(client, "fake.mp4", b"not really a video")

    assert response.status_code == 422
    assert client.get("/api/v1/uploads").json() == []
    assert list(store.upload_dir.iterdir()) == []


def test_upload_rejects_file_over_size_limit(client, store, monkeypatch):
    monkeypatch.setattr(settings, "MAX_UPLOAD_SIZE_MB", 0)

    response = upload(client, "big.mp4", b"x" * 10)

    assert response.status_code == 413
    assert list(store.upload_dir.iterdir()) == []


@needs_ffmpeg
def test_delete_removes_record_and_file(client, store, sample_video):
    body = upload(client, sample_video.name, sample_video.read_bytes()).json()

    response = client.delete(f"/api/v1/uploads/{body['id']}")

    assert response.status_code == 204
    assert client.get("/api/v1/uploads").json() == []
    assert not (store.upload_dir / body["stored_as"]).exists()


def test_delete_unknown_upload_returns_404(client):
    assert client.delete("/api/v1/uploads/unknown").status_code == 404
