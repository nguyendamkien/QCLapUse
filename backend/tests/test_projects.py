from datetime import datetime, timezone

import pytest

from app.schemas.annotation import Annotation
from app.schemas.upload import Upload


@pytest.fixture
def two_videos(store):
    for upload_id in ("a", "b"):
        store.add(
            Upload(
                id=upload_id, name=f"{upload_id}.mp4", size=1, duration=1.0,
                stored_as=f"{upload_id}.mp4", created_at=datetime.now(timezone.utc),
            )
        )


def create(client, name):
    return client.post("/api/v1/projects", json={"name": name})


def move(client, ids, project_id):
    return client.post("/api/v1/uploads/project", json={"upload_ids": ids, "project_id": project_id})


def test_create_and_list_in_creation_order(client):
    first = create(client, "  Kho Đà Nẵng ").json()
    create(client, "Văn phòng")
    assert first["name"] == "Kho Đà Nẵng"
    assert [p["name"] for p in client.get("/api/v1/projects").json()] == ["Kho Đà Nẵng", "Văn phòng"]


def test_rejects_blank_and_duplicate_names(client):
    create(client, "Kho")
    assert create(client, "   ").status_code == 422
    assert create(client, "kho").status_code == 409


def test_rename(client):
    kho = create(client, "Kho").json()
    other = create(client, "Văn phòng").json()
    assert client.patch(f"/api/v1/projects/{kho['id']}", json={"name": "Kho 2"}).json()["name"] == "Kho 2"
    # Đổi sang đúng tên cũ của chính nó thì được, trùng project khác thì không
    assert client.patch(f"/api/v1/projects/{kho['id']}", json={"name": "kho 2"}).status_code == 200
    assert client.patch(f"/api/v1/projects/{kho['id']}", json={"name": other["name"]}).status_code == 409
    assert client.patch("/api/v1/projects/missing", json={"name": "X"}).status_code == 404


def test_move_videos_between_projects(client, store, two_videos):
    kho = create(client, "Kho").json()
    response = move(client, ["a", "b"], kho["id"])
    assert [u["project_id"] for u in response.json()] == [kho["id"], kho["id"]]
    assert store.get("a").project_id == kho["id"]

    move(client, ["a"], None)
    assert store.get("a").project_id is None
    assert store.get("b").project_id == kho["id"]


def test_move_rejects_unknown_project_or_video(client, store, two_videos):
    assert move(client, ["a"], "missing").status_code == 404
    kho = create(client, "Kho").json()
    assert move(client, ["a", "x"], kho["id"]).status_code == 404
    assert store.get("a").project_id is None


def test_delete_project_deletes_its_videos(client, store, annotation_store, two_videos):
    kho = create(client, "Kho").json()
    move(client, ["a"], kho["id"])
    (store.upload_dir / "a.mp4").write_bytes(b"video")
    (store.upload_dir / "a.play.mp4").write_bytes(b"proxy")
    annotation_store.save(Annotation(upload_id="a"))

    assert client.delete(f"/api/v1/projects/{kho['id']}").status_code == 204
    assert client.get("/api/v1/projects").json() == []
    # Video trong project bị xoá hết: bản ghi, file gốc, bản xem, nhãn
    assert store.get("a") is None
    assert not (store.upload_dir / "a.mp4").exists()
    assert not (store.upload_dir / "a.play.mp4").exists()
    assert "a" not in annotation_store.summaries()
    # Video ngoài project không bị ảnh hưởng
    assert store.get("b") is not None
    assert client.delete(f"/api/v1/projects/{kho['id']}").status_code == 404


def test_upload_into_project(client, sample_video):
    kho = create(client, "Kho").json()
    files = {"file": (sample_video.name, sample_video.read_bytes(), "video/mp4")}

    response = client.post("/api/v1/uploads", files=files, data={"project_id": kho["id"]})
    assert response.status_code == 201
    assert response.json()["project_id"] == kho["id"]

    assert client.post("/api/v1/uploads", files=files, data={"project_id": "missing"}).status_code == 404
    assert len(client.get("/api/v1/uploads").json()) == 1
