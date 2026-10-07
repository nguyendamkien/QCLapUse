import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.api.deps import (
    get_annotation_store,
    get_eval_model_store,
    get_eval_store,
    get_gt_store,
    get_project_store,
    get_upload_store,
)
from app.main import app
from app.services.annotation_store import AnnotationStore
from app.services.eval_model_store import EvalModelStore
from app.services.eval_store import EvalStore
from app.services.gt_store import GtStore
from app.services.project_store import ProjectStore
from app.services.upload_store import UploadStore


@pytest.fixture
def annotation_store(tmp_path):
    return AnnotationStore(tmp_path / "annotations")


@pytest.fixture
def gt_store(tmp_path):
    return GtStore(tmp_path / "gt")


@pytest.fixture
def project_store(tmp_path):
    return ProjectStore(tmp_path / "uploads" / "projects.json")


@pytest.fixture
def eval_store(tmp_path):
    return EvalStore(tmp_path / "evaluations")


@pytest.fixture
def eval_model_store(tmp_path):
    return EvalModelStore(tmp_path / "eval_models")


@pytest.fixture
def store(tmp_path, annotation_store, gt_store, project_store, eval_store, eval_model_store):
    store = UploadStore(tmp_path / "uploads")
    app.dependency_overrides[get_upload_store] = lambda: store
    app.dependency_overrides[get_annotation_store] = lambda: annotation_store
    app.dependency_overrides[get_gt_store] = lambda: gt_store
    app.dependency_overrides[get_project_store] = lambda: project_store
    app.dependency_overrides[get_eval_store] = lambda: eval_store
    app.dependency_overrides[get_eval_model_store] = lambda: eval_model_store
    yield store
    app.dependency_overrides.clear()


@pytest.fixture
def client(store):
    return TestClient(app)


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory):
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        pytest.skip("Cần ffmpeg và ffprobe để tạo và đọc video thử")
    path = tmp_path_factory.mktemp("videos") / "cam03_2026-09-24.mp4"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=10",
            "-pix_fmt", "yuv420p", str(path),
        ],
        check=True,
    )
    return path


@pytest.fixture
def uploaded_video(client, sample_video):
    response = client.post(
        "/api/v1/uploads",
        files={"file": (sample_video.name, sample_video.read_bytes(), "video/mp4")},
    )
    assert response.status_code == 201
    return response.json()
