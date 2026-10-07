"""Tải model lên và chạy model qua video của project. Model và ffmpeg được thay bằng bản giả."""

import pytest

from app.schemas.evaluation import PredBox
from app.services import model_runner
from app.services.autolabel import detector
from tests.test_evaluations import A, B, MID, project  # noqa: F401 - fixture project dùng chung

CLASSES = {0: "using_laptop", 1: "person"}


@pytest.fixture
def fake_library(monkeypatch):
    monkeypatch.setattr(detector, "is_available", lambda: True)
    monkeypatch.setattr(model_runner, "read_classes", lambda path, filename=None: CLASSES)
    # Không đọc video thật: "ảnh" của mỗi frame chính là số frame, để model giả biết đang ở frame nào
    monkeypatch.setattr(
        detector, "iter_frames", lambda path, width, height, step: ((f, f) for f in range(0, 20, step))
    )


def fake_predictor(boxes_by_frame):
    def load(path, class_names, score_threshold, filename=None):
        return lambda frame: [PredBox(bbox=b, score=0.9) for b in boxes_by_frame.get(frame, [])]

    return load


def upload_model(client, name="yolo-laptop.pt", content=b"weights"):
    return client.post("/api/v1/eval-models", files={"file": (name, content)}, data={"name": "YOLO laptop"})


def start(client, project, model, **extra):
    return client.post(
        "/api/v1/evaluations/run",
        json={"project_id": project["id"], "model_id": model["id"], **extra},
    )


def test_upload_list_and_delete_model(client, fake_library, eval_model_store):
    response = upload_model(client)
    assert response.status_code == 201
    model = response.json()
    assert model["name"] == "YOLO laptop"
    assert model["classes"] == {"0": "using_laptop", "1": "person"}
    assert (eval_model_store.model_dir / model["stored_as"]).exists()

    assert [m["id"] for m in client.get("/api/v1/eval-models").json()] == [model["id"]]
    assert client.delete(f"/api/v1/eval-models/{model['id']}").status_code == 204
    assert not (eval_model_store.model_dir / model["stored_as"]).exists()
    assert client.get("/api/v1/eval-models").json() == []


def test_rejects_bad_model_file(client, fake_library, monkeypatch, eval_model_store):
    assert upload_model(client, name="model.txt").status_code == 415

    def broken(path, filename=None):
        raise ValueError("Không đọc được file model: hỏng")

    monkeypatch.setattr(model_runner, "read_classes", broken)
    response = upload_model(client)
    assert response.status_code == 422
    # File hỏng bị xoá, không để lại rác
    assert [p.name for p in eval_model_store.model_dir.iterdir()] == []


def test_needs_model_library(client, monkeypatch):
    monkeypatch.setattr(detector, "is_available", lambda: False)
    assert upload_model(client).status_code == 503


def test_run_model_over_project_and_score(client, fake_library, monkeypatch, project):  # noqa: F811
    model = upload_model(client).json()
    # Model giả trả cùng box ở frame 5, 10, 15 cho mọi video: đúng hết với "pos", thừa hết với "neg"
    monkeypatch.setattr(model_runner, "load_predictor", fake_predictor({5: [A], 10: [MID], 15: [B]}))
    seen = []
    real_predict = model_runner.predict_uploads

    def spy(predictor, uploads, *args):
        seen.extend(u.id for u in uploads)
        return real_predict(predictor, uploads, *args)

    monkeypatch.setattr(model_runner, "predict_uploads", spy)

    job = start(client, project, model, classes=["using_laptop"], name="Lượt thử")
    assert job.status_code == 202

    # TestClient chạy background task ngay sau khi trả response
    done = client.get(f"/api/v1/evaluations/jobs/{job.json()['id']}").json()
    assert done["status"] == "done", done
    assert [j["id"] for j in client.get("/api/v1/evaluations/jobs", params={"project_id": project["id"]}).json()] == [
        done["id"]
    ]

    run = client.get(f"/api/v1/evaluations/{done['run_id']}").json()
    assert run["name"] == "Lượt thử"
    assert (run["source"], run["model"], run["classes"]) == ("model", "YOLO laptop", ["using_laptop"])
    videos = {v["upload_id"]: v for v in run["videos"]}
    assert videos["pos"]["box"] == {"tp": 3, "fp": 0, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0}
    assert videos["neg"]["box"]["fp"] == 3
    # Chỉ chạy model trên video đủ điều kiện, bỏ qua video chưa phân loại
    assert sorted(seen) == ["neg", "pos"]


def test_run_rejects_bad_requests(client, fake_library, project, store):  # noqa: F811
    model = upload_model(client).json()
    assert start(client, project, {"id": "missing"}).status_code == 404
    assert start(client, {"id": "missing"}, model).status_code == 404
    assert start(client, project, model, classes=["cat"]).status_code == 422

    empty = client.post("/api/v1/projects", json={"name": "Rỗng"}).json()
    assert start(client, empty, model).status_code == 409


def test_run_errors_are_reported(client, fake_library, monkeypatch, project):  # noqa: F811
    model = upload_model(client).json()

    def broken(path, class_names, score_threshold, filename=None):
        raise RuntimeError("Hết bộ nhớ")

    monkeypatch.setattr(model_runner, "load_predictor", broken)
    job = start(client, project, model).json()
    status = client.get(f"/api/v1/evaluations/jobs/{job['id']}").json()
    assert (status["status"], status["error"]) == ("error", "Hết bộ nhớ")
    assert client.get("/api/v1/evaluations/jobs/khong-co").status_code == 404
