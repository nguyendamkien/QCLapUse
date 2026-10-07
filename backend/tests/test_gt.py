from datetime import datetime, timezone

import pytest

from app.schemas.annotation import Annotation
from app.schemas.upload import Upload

BOX_A = {"x": 0.1, "y": 0.2, "w": 0.2, "h": 0.4}
BOX_B = {"x": 0.3, "y": 0.2, "w": 0.2, "h": 0.4}


def add_video(store, upload_id, group, fps=10.0, duration=2.0):
    """Video 2 giây, 10 fps: 20 frame (0 đến 19)."""
    store.add(
        Upload(
            id=upload_id,
            name=f"{upload_id}.mp4",
            size=1,
            duration=duration,
            fps=fps,
            width=640,
            height=360,
            stored_as=f"{upload_id}.mp4",
            created_at=datetime.now(timezone.utc),
            group=group,
        )
    )


def label(annotation_store, upload_id, tracks, done=True):
    annotation_store.save(
        Annotation(upload_id=upload_id, tracks=tracks, done=done, updated_at=datetime.now(timezone.utc))
    )


def create_gt(client, ids, frame_step=5, note=None):
    return client.post("/api/v1/gt", json={"upload_ids": ids, "frame_step": frame_step, "note": note})


@pytest.fixture
def ready_videos(store, annotation_store):
    add_video(store, "pos", "using")
    # Người #1 có mặt frame 2 đến 17, box vẽ ở frame 5 và 15
    label(annotation_store, "pos", [{"track_id": 1, "segments": [{"start": 2, "end": 17}], "keyframes": {5: BOX_A, 15: BOX_B}}])
    add_video(store, "neg", "not_using")
    add_video(store, "new", None)


def checks_by_id(client):
    body = client.get("/api/v1/gt/readiness").json()
    return body, {v["upload_id"]: v for v in body["videos"]}


def test_readiness_lists_only_classified_videos(client, ready_videos):
    body, checks = checks_by_id(client)

    assert set(checks) == {"pos", "neg"}
    assert body["unclassified_count"] == 1
    assert checks["pos"]["eligible"] and checks["pos"]["issues"] == []


@pytest.mark.parametrize(
    "tracks, upload_changes, expected",
    [
        ([], {}, "Chưa gán người nào"),
        ([{"track_id": 1, "segments": [{"start": 0, "end": None}], "keyframes": {0: BOX_A}}], {}, "chưa kết thúc"),
        ([{"track_id": 1, "segments": [{"start": 0, "end": 5}], "keyframes": {0: BOX_A}}], {"fps": None}, "fps"),
    ],
)
def test_blocking_issues(client, store, annotation_store, tracks, upload_changes, expected):
    add_video(store, "v", "using")
    store.update(store.get("v").model_copy(update=upload_changes))
    label(annotation_store, "v", tracks)

    _, checks = checks_by_id(client)

    assert not checks["v"]["eligible"]
    assert any(expected in i["message"] for i in checks["v"]["issues"] if i["level"] == "error")
    assert create_gt(client, ["v"]).status_code == 409


def test_warnings_do_not_block(client, store, annotation_store):
    add_video(store, "v", "using")
    label(annotation_store, "v", [{"track_id": 1, "segments": [{"start": 0, "end": 5}], "keyframes": {}}])

    _, checks = checks_by_id(client)

    assert checks["v"]["eligible"]
    assert {i["level"] for i in checks["v"]["issues"]} == {"warning"}
    assert create_gt(client, ["v"]).status_code == 201


def test_create_gt_content(client, gt_store, ready_videos):
    response = create_gt(client, ["pos", "neg"], frame_step=5, note=" Batch 1 ")

    assert response.status_code == 201
    info = response.json()
    assert info["gt_version"] == "v1"
    assert info["note"] == "Batch 1"
    assert info["stats"]["video_count"] == 2
    assert info["stats"]["eval_frame_count"] == 8  # 4 frame được chấm mỗi video: 0, 5, 10, 15

    gt = client.get("/api/v1/gt/v1").json()
    pos, neg = gt["videos"]
    assert pos["total_frames"] == 20
    assert pos["events"] == [{"track_id": 1, "start": 2, "end": 17}]
    # Chỉ frame chia hết cho 5 và nằm giữa hai keyframe mới có box
    assert sorted(int(f) for f in pos["frames"]) == [5, 10, 15]
    assert pos["frames"]["5"][0]["source"] == "keyframe"
    assert pos["frames"]["10"][0]["source"] == "interpolated"
    assert pos["frames"]["10"][0]["bbox"] == pytest.approx([0.2, 0.2, 0.2, 0.4])
    # Đầu và cuối đoạn chưa có box thì không chấm
    assert [(i["start"], i["end"]) for i in pos["ignore"]] == [(2, 4), (16, 17)]
    assert (neg["frames"], neg["events"], neg["ignore"]) == ({}, [], [])


def test_gt_is_a_snapshot(client, annotation_store, ready_videos):
    create_gt(client, ["pos"])

    label(annotation_store, "pos", [{"track_id": 1, "segments": [{"start": 0, "end": 19}], "keyframes": {0: BOX_A}}])
    create_gt(client, ["pos"])

    assert client.get("/api/v1/gt/v1").json()["videos"][0]["events"][0]["start"] == 2
    assert client.get("/api/v1/gt/v2").json()["videos"][0]["events"][0]["start"] == 0
    assert [v["gt_version"] for v in client.get("/api/v1/gt").json()] == ["v2", "v1"]


def test_create_rejects_unclassified_and_unknown(client, ready_videos):
    assert create_gt(client, ["new"]).status_code == 409
    assert create_gt(client, ["missing"]).status_code == 404
    assert client.get("/api/v1/gt").json() == []


def test_download_and_unknown_version(client, ready_videos):
    create_gt(client, ["neg"])

    response = client.get("/api/v1/gt/v1/download")

    assert response.status_code == 200
    assert "gt_v1.json" in response.headers["content-disposition"]
    assert client.get("/api/v1/gt/v9").status_code == 404
    assert client.get("/api/v1/gt/..%2Findex/download").status_code == 404


def test_preview_follows_current_labels(client, annotation_store, ready_videos):
    body = client.get("/api/v1/gt/preview/pos?frame_step=5").json()

    assert body["eligible"]
    assert sorted(int(f) for f in body["video"]["frames"]) == [5, 10, 15]

    # Đoạn chưa kết thúc: vẫn xem được, kéo tới hết video, nhưng bị chặn khi khoá
    label(annotation_store, "pos", [{"track_id": 1, "segments": [{"start": 2, "end": None}], "keyframes": {5: BOX_A}}])
    body = client.get("/api/v1/gt/preview/pos").json()

    assert not body["eligible"]
    assert body["video"]["events"] == [{"track_id": 1, "start": 2, "end": 19}]
    assert [(i["start"], i["end"]) for i in body["video"]["ignore"]] == [(2, 4), (6, 19)]
    assert client.get("/api/v1/gt").json() == []


def test_preview_needs_classification(client, ready_videos):
    assert client.get("/api/v1/gt/preview/new").status_code == 409
    assert client.get("/api/v1/gt/preview/missing").status_code == 404


def test_warns_when_labeling_not_marked_done(client, store, annotation_store):
    add_video(store, "v", "using")
    label(annotation_store, "v", [{"track_id": 1, "segments": [{"start": 0, "end": 5}], "keyframes": {0: BOX_A}}], done=False)

    _, checks = checks_by_id(client)

    assert checks["v"]["eligible"]
    assert any("chưa đánh dấu" in i["message"] for i in checks["v"]["issues"] if i["level"] == "warning")
