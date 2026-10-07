from datetime import datetime, timezone

import pytest

from app.schemas.upload import Upload


def add_upload(store, upload_id):
    upload = Upload(
        id=upload_id,
        name=f"{upload_id}.mp4",
        size=1,
        duration=1.0,
        stored_as=f"{upload_id}.mp4",
        created_at=datetime.now(timezone.utc),
    )
    store.add(upload)
    return upload


@pytest.fixture
def two_videos(store):
    return [add_upload(store, "a"), add_upload(store, "b")]


def classify(client, ids, group):
    return client.post("/api/v1/uploads/classify", json={"upload_ids": ids, "group": group})


def test_new_upload_is_unclassified(client, two_videos):
    body = client.get("/api/v1/uploads/a").json()

    assert body["group"] is None
    assert "review_status" not in body


def test_classify_many_videos_at_once(client, store, two_videos):
    response = classify(client, ["a", "b"], "using")

    assert response.status_code == 200
    for upload_id in ("a", "b"):
        saved = store.get(upload_id)
        assert saved.group == "using"
        assert saved.classified_at is not None


def test_classify_rejects_unknown_group(client, store, two_videos):
    response = classify(client, ["a"], "sitting")

    assert response.status_code == 422
    assert store.get("a").group is None


def test_classify_unknown_video_changes_nothing(client, store, two_videos):
    response = classify(client, ["a", "missing"], "using")

    assert response.status_code == 404
    assert store.get("a").group is None


def test_move_back_to_unclassified(client, store, two_videos):
    classify(client, ["a"], "using")

    classify(client, ["a"], None)

    saved = store.get("a")
    assert (saved.group, saved.classified_at) == (None, None)


def test_review_api_is_gone(client, two_videos):
    response = client.post("/api/v1/uploads/review", json={"upload_ids": ["a"], "status": "approved"})

    assert response.status_code in (404, 405)


def test_upload_keeps_suggested_group(client, sample_video):
    response = client.post(
        "/api/v1/uploads",
        files={"file": (sample_video.name, sample_video.read_bytes(), "video/mp4")},
        data={"suggested_group": "not_using"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["suggested_group"] == "not_using"
    assert body["group"] is None
