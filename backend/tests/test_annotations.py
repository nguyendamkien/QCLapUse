import json

import pytest

BOX_A = {"x": 0.1, "y": 0.2, "w": 0.2, "h": 0.4}
BOX_B = {"x": 0.3, "y": 0.2, "w": 0.2, "h": 0.4}


def track(track_id=1, segments=None, keyframes=None):
    return {
        "track_id": track_id,
        "segments": [{"start": 0, "end": 4}] if segments is None else segments,
        "keyframes": keyframes or {"0": BOX_A, "4": BOX_B},
    }


def annotation_url(upload_id):
    return f"/api/v1/uploads/{upload_id}/annotation"


def put(client, upload_id, payload):
    return client.put(annotation_url(upload_id), json=payload)


def test_new_video_has_empty_annotation(client, uploaded_video):
    body = client.get(annotation_url(uploaded_video["id"])).json()

    assert body["upload_id"] == uploaded_video["id"]
    assert body["tracks"] == []
    assert body["case"] is None


def test_save_and_reload_tracks(client, uploaded_video):
    payload = {"tracks": [track(1), track(2, [{"start": 2, "end": None}], {"3": BOX_A})], "case": "holding"}

    saved = put(client, uploaded_video["id"], payload)

    assert saved.status_code == 200
    body = client.get(annotation_url(uploaded_video["id"])).json()
    assert [t["track_id"] for t in body["tracks"]] == [1, 2]
    assert body["tracks"][1]["segments"] == [{"start": 2, "end": None}]
    assert body["case"] == "holding"

    summary = client.get("/api/v1/annotations/summary").json()
    assert summary[uploaded_video["id"]] == {
        "track_count": 2,
        "case": "holding",
        "done": False,
        "auto_pending": 0,
        "updated_at": body["updated_at"],
    }


@pytest.mark.parametrize(
    "bad_track, reason",
    [
        (track(keyframes={"0": {**BOX_A, "x": 0.9}}), "box ra ngoài khung hình"),
        (track(segments=[{"start": 5, "end": 2}], keyframes={"5": BOX_A}), "kết thúc trước bắt đầu"),
        (track(segments=[{"start": 0, "end": 5}, {"start": 3, "end": 8}]), "các đoạn chồng nhau"),
        (track(segments=[{"start": 0, "end": None}, {"start": 9, "end": 12}]), "đoạn mở không phải đoạn cuối"),
        (track(keyframes={"0": BOX_A, "7": BOX_B}), "keyframe ngoài đoạn"),
        (track(segments=[]), "track không có đoạn nào"),
    ],
)
def test_rejects_invalid_track(client, uploaded_video, bad_track, reason):
    response = put(client, uploaded_video["id"], {"tracks": [bad_track]})

    assert response.status_code == 422, reason


def test_rejects_duplicate_track_ids(client, uploaded_video):
    response = put(client, uploaded_video["id"], {"tracks": [track(1), track(1)]})

    assert response.status_code == 422


def test_frames_interpolates_between_keyframes(client, uploaded_video):
    # Video thử dài 1 giây, 10 fps, tức 10 frame (0 đến 9)
    put(
        client,
        uploaded_video["id"],
        {
            "tracks": [
                track(1, [{"start": 0, "end": 4}], {"0": BOX_A, "4": BOX_B}),
                track(2, [{"start": 7, "end": None}], {"8": BOX_A}),
            ]
        },
    )

    frames = client.get(f"{annotation_url(uploaded_video['id'])}/frames").json()

    # Người #2 chỉ có một box ở frame 8, nên frame 7 và 9 chưa có box
    assert sorted(map(int, frames)) == [0, 1, 2, 3, 4, 8]
    middle = frames["2"][0]
    assert middle["track_id"] == 1
    assert middle["x"] == pytest.approx(0.2)
    assert middle["is_keyframe"] is False
    assert frames["4"][0]["is_keyframe"] is True
    assert frames["8"][0]["track_id"] == 2


def test_segment_without_boxes_is_allowed_and_skipped_in_frames(client, uploaded_video):
    # Người #1 xuất hiện ở frame 2–5 nhưng chưa vẽ box; đoạn 7–8 chỉ có box ở frame 7,
    # frame 8 nằm sau box cuối nên chưa có box (chỉ nội suy giữa hai box gán tay)
    event_only = {"track_id": 1, "segments": [{"start": 2, "end": 5}, {"start": 7, "end": 8}], "keyframes": {"7": BOX_A}}

    saved = put(client, uploaded_video["id"], {"tracks": [event_only]})
    frames = client.get(f"{annotation_url(uploaded_video['id'])}/frames").json()

    assert saved.status_code == 200
    assert sorted(map(int, frames)) == [7]


def test_old_frame_annotation_is_converted_to_tracks(client, uploaded_video, annotation_store):
    person = {"id": "b1", "label": "person", "track_id": 1, **BOX_A}
    old = {
        "upload_id": uploaded_video["id"],
        "frame_step": 5,
        "frames": {
            "5": [person, {**person, "id": "l1", "label": "laptop"}],
            "0": [{**person, "interaction": "sitting"}, {**person, "track_id": 3, "interaction": "not_using"}],
            "9": [{**person, **BOX_B}],
        },
        "case": None,
    }
    (annotation_store.annotation_dir / f"{uploaded_video['id']}.json").write_text(json.dumps(old), encoding="utf-8")

    body = client.get(annotation_url(uploaded_video["id"])).json()

    assert body["tracks"] == [
        {
            "track_id": 1,
            "segments": [{"start": 0, "end": 9}],
            "keyframes": {
                "0": {**BOX_A, "confidence": None},
                "5": {**BOX_A, "confidence": None},
                "9": {**BOX_B, "confidence": None},
            },
            "origin": "human",
            "confirmed": True,
        }
    ]


def test_annotation_for_unknown_video_returns_404(client):
    assert client.get(annotation_url("unknown")).status_code == 404
    assert client.put(annotation_url("unknown"), json={}).status_code == 404


def test_deleting_video_removes_its_annotation(client, uploaded_video, annotation_store):
    put(client, uploaded_video["id"], {"tracks": [track()]})

    client.delete(f"/api/v1/uploads/{uploaded_video['id']}")

    assert annotation_store.summaries() == {}


def test_stream_video_supports_range_requests(client, uploaded_video):
    url = f"/api/v1/uploads/{uploaded_video['id']}/video"

    full = client.get(url)
    partial = client.get(url, headers={"Range": "bytes=0-99"})

    assert full.status_code == 200
    assert full.headers["content-type"] == "video/mp4"
    assert partial.status_code == 206
    assert len(partial.content) == 100


def test_get_upload_fills_missing_video_info(client, store, uploaded_video):
    old = store.get(uploaded_video["id"]).model_copy(update={"fps": None, "width": None, "height": None})
    store.update(old)

    body = client.get(f"/api/v1/uploads/{uploaded_video['id']}").json()

    assert body["fps"] == 10
    assert store.get(uploaded_video["id"]).fps == 10


def test_mark_labeling_done(client, uploaded_video):
    put(client, uploaded_video["id"], {"tracks": [track(1)], "done": True})

    assert client.get(annotation_url(uploaded_video["id"])).json()["done"] is True
    assert client.get("/api/v1/annotations/summary").json()[uploaded_video["id"]]["done"] is True
