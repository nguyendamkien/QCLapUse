from datetime import datetime, timezone

import pytest

from app.schemas.annotation import Annotation
from app.schemas.upload import Upload
from app.services.autolabel import detector as detector_module
from app.services.autolabel import jobs
from app.services.autolabel.pipeline import (
    Detection,
    Params,
    Sample,
    build_tracks,
    runs_to_segments,
    select_keyframes,
    static_devices,
    track_people,
)

PERSON = (100, 100, 200, 300)
LAPTOP = (120, 220, 180, 250)  # nằm trong box người, ở phần thân: đang dùng
FAR_LAPTOP = (500, 220, 560, 250)  # xa người: không dùng


def person(box=PERSON, score=0.9):
    return Detection("person", score, box)


def laptop(box=LAPTOP, score=0.8):
    return Detection("laptop", score, box)


# ---------------------------------------------------------------- pipeline


def test_tracking_keeps_same_person_and_splits_far_boxes():
    samples = [
        Sample(0, [person((100, 100, 200, 300)), person((600, 100, 700, 300))]),
        Sample(10, [person((105, 100, 205, 300)), person((605, 100, 705, 300))]),
        Sample(20, [person((110, 100, 210, 300))]),
    ]

    tracks = track_people(samples, Params())

    assert sorted(len(t.points) for t in tracks) == [2, 3]


def test_tracking_follows_fast_move_by_center_distance():
    # Dịch 60 px trong một bước: IoU chỉ 0.25 nhưng tâm dịch 0.27 đường chéo (dưới 0.3)
    samples = [Sample(0, [person((100, 100, 200, 300))]), Sample(10, [person((160, 100, 260, 300))])]

    assert [len(t.points) for t in track_people(samples, Params())] == [2]


def test_tracking_does_not_join_distant_people():
    samples = [Sample(0, [person((100, 100, 200, 300))]), Sample(10, [person((500, 100, 600, 300))])]

    assert len(track_people(samples, Params())) == 2


RED = (1.0, 0.0)
BLUE = (0.0, 1.0)


def test_appearance_stops_switch_when_someone_walks_in_front():
    # Người áo xanh đi ngang, đứng đúng chỗ người áo đỏ bị che: vị trí khớp nhưng màu khác hẳn
    samples = [
        Sample(0, [Detection("person", 0.9, (100, 100, 200, 300), RED)]),
        Sample(5, [Detection("person", 0.9, (110, 100, 210, 300), BLUE)]),
    ]

    assert len(track_people(samples, Params())) == 2


def test_person_hidden_briefly_keeps_same_track():
    # Bị che 1,2 giây (30 frame) rồi hiện lại đúng chỗ, cùng màu áo
    samples = [
        Sample(0, [Detection("person", 0.9, PERSON, RED)]),
        Sample(30, [Detection("person", 0.9, PERSON, RED)]),
    ]

    assert [len(t.points) for t in track_people(samples, Params(), fps=25)] == [2]


def test_stitching_joins_fragments_with_same_look_only():
    # Hai đoạn cách nhau 2,4 giây (quá thời gian giữ track), cùng màu thì nối, khác màu thì không
    first = Sample(0, [Detection("person", 0.9, PERSON, RED)])
    same_look = Sample(60, [Detection("person", 0.9, (150, 100, 250, 300), RED)])
    other_look = Sample(60, [Detection("person", 0.9, (150, 100, 250, 300), BLUE)])

    assert len(track_people([first, same_look], Params(), fps=25)) == 1
    assert len(track_people([first, other_look], Params(), fps=25)) == 2


def test_half_body_duplicate_box_is_dropped():
    upper_body = (110, 100, 200, 200)
    samples = [Sample(f, [person(), person(upper_body, score=0.7)]) for f in (0, 10)]

    assert [len(t.points) for t in track_people(samples, Params())] == [2]


def test_low_score_people_are_ignored():
    assert track_people([Sample(0, [person(score=0.3)])], Params()) == []


# ---------------------------------------------------------------- ByteTrack


def test_bytetrack_keeps_person_through_low_score_frames():
    pytest.importorskip("ultralytics")
    from app.services.autolabel.bytetrack import track_people_bytetrack

    # Người bị che một phần ở frame 20 và 30: model chỉ chắc 0,3 nhưng vẫn giữ cùng một track
    samples = [Sample(f, [person(score=0.3 if f in (20, 30) else 0.9)]) for f in range(0, 60, 10)]

    tracks = track_people_bytetrack(samples, Params(), fps=25)

    assert [[frame for frame, _, _ in t.points] for t in tracks] == [[0, 10, 20, 30, 40, 50]]


def test_bytetrack_does_not_start_track_from_low_score_box():
    pytest.importorskip("ultralytics")
    from app.services.autolabel.bytetrack import track_people_bytetrack

    assert track_people_bytetrack([Sample(f, [person(score=0.3)]) for f in (0, 10)], Params()) == []


def test_bytetrack_separates_two_people():
    pytest.importorskip("ultralytics")
    from app.services.autolabel.bytetrack import track_people_bytetrack

    samples = [
        Sample(f, [person((100 + f, 100, 200 + f, 300)), person((500, 100, 600, 300))]) for f in range(0, 50, 10)
    ]

    assert sorted(len(t.points) for t in track_people_bytetrack(samples, Params(), fps=25)) == [5, 5]


def test_static_device_found_even_if_missed_in_some_frames():
    samples = [Sample(i * 10, [laptop()] if i % 3 else []) for i in range(30)]

    devices = static_devices(samples, Params())

    assert len(devices) == 1
    assert devices[0] == pytest.approx(LAPTOP)


def test_segments_fill_short_gaps_and_drop_short_runs():
    frames = list(range(0, 200, 10))
    flags = [True] * 5 + [False] * 2 + [True] * 5 + [False] * 6 + [True, False]

    # Frame 40 tới 70 cách 30 (<= max_gap) thì gộp; đoạn cuối chỉ có frame 180 thì bỏ vì quá ngắn
    assert runs_to_segments(frames, flags, max_gap=30, min_length=25) == [(0, 110)]


def test_keyframes_only_where_motion_changes():
    still = [(f, (100, 100, 200, 300), 0.9) for f in range(0, 100, 10)]
    assert select_keyframes(still, 0.8) == [0, 9]

    # Đi thẳng rồi quay đầu: cần thêm keyframe ở chỗ quay đầu
    def shifted(f):
        dx = 2 * min(f, 100 - f)
        return (100 + dx, 100, 200 + dx, 300)

    zigzag = [(f, shifted(f), 0.9) for f in range(0, 101, 10)]
    assert select_keyframes(zigzag, 0.8) == [0, 5, 10]


def test_build_tracks_marks_only_person_near_device():
    samples = [Sample(f, [person(), person((400, 100, 500, 300)), laptop()]) for f in range(0, 100, 10)]

    tracks = build_tracks(samples, width=640, height=360, fps=25, params=Params())

    assert len(tracks) == 1
    track = tracks[0]
    assert track["origin"] == "auto" and track["confirmed"] is False
    assert track["segments"] == [{"start": 0, "end": 90}]
    first = track["keyframes"][0]
    assert first["x"] == pytest.approx(100 / 640) and first["w"] == pytest.approx(100 / 640)
    assert first["confidence"] == 0.9


def test_each_continuous_run_is_its_own_track():
    # Người dùng máy 0-2 giây, rời khỏi chỗ laptop 2 giây (lâu hơn khoảng hở cho phép), rồi quay lại dùng tiếp
    away = (400, 100, 500, 300)
    samples = [
        Sample(f, [person(PERSON if f < 50 or f >= 100 else away), laptop()]) for f in range(0, 150, 5)
    ]

    tracks = build_tracks(samples, 640, 360, 25, Params())

    assert [t["segments"] for t in tracks] == [[{"start": 0, "end": 45}], [{"start": 100, "end": 145}]]
    assert [t["track_id"] for t in tracks] == [1, 2]
    # Keyframe của track nào nằm trong đoạn của track đó
    assert all(t["segments"][0]["start"] <= f <= t["segments"][0]["end"] for t in tracks for f in t["keyframes"])


def test_short_detection_gap_does_not_split_track():
    # Model bỏ sót laptop ở 3 frame lấy mẫu (0,4 giây < 1 giây khoảng hở cho phép): vẫn một track
    samples = [Sample(f, [person(), laptop()] if not 50 <= f < 60 else [person()]) for f in range(0, 150, 5)]

    tracks = build_tracks(samples, 640, 360, 25, Params())

    assert [t["segments"] for t in tracks] == [[{"start": 0, "end": 145}]]


def test_build_tracks_ignores_device_at_head_height():
    # Laptop gập trên bàn phía sau, ngang đầu người đang ngồi nói chuyện: không phải đang dùng
    behind_head = (110, 95, 190, 140)
    samples = [Sample(f, [person(), laptop(behind_head)]) for f in range(0, 100, 10)]

    assert build_tracks(samples, 640, 360, 25, Params()) == []


def test_keyboard_of_desktop_computer_does_not_count():
    # Chỉ tính laptop: người ngồi gõ bàn phím máy để bàn không được đề xuất
    samples = [Sample(f, [person(), Detection("keyboard", 0.9, LAPTOP)]) for f in range(0, 100, 10)]

    assert build_tracks(samples, 640, 360, 25, Params()) == []


def test_build_tracks_ignores_device_far_away():
    samples = [Sample(f, [person(), laptop(FAR_LAPTOP)]) for f in range(0, 100, 10)]

    assert build_tracks(samples, 640, 360, 25, Params()) == []


# ---------------------------------------------------------------- API


class FakeDetector:
    def detect(self, rgb):
        return [person(), laptop()]


@pytest.fixture
def fake_model(monkeypatch):
    monkeypatch.setattr(detector_module, "is_available", lambda: True)
    used_models = []

    def fake_get_detector(labels, min_score, model_file=None):
        used_models.append(model_file)
        return FakeDetector()

    monkeypatch.setattr(detector_module, "get_detector", fake_get_detector)
    monkeypatch.setattr(
        detector_module, "iter_frames", lambda path, width, height, step: ((f, None) for f in range(0, 250, step))
    )
    jobs._jobs.clear()
    return used_models


@pytest.fixture
def video(store):
    store.add(
        Upload(
            id="v",
            name="v.mp4",
            size=1,
            duration=10.0,
            fps=25.0,
            width=640,
            height=360,
            stored_as="v.mp4",
            created_at=datetime.now(timezone.utc),
            group="using",
        )
    )


def autolabel(client):
    return client.post("/api/v1/uploads/v/autolabel")


def test_autolabel_writes_unconfirmed_tracks(client, annotation_store, fake_model, video):
    response = autolabel(client)

    assert response.status_code == 202
    status = client.get("/api/v1/uploads/v/autolabel").json()
    assert status["status"] == "done" and status["track_count"] == 1

    annotation = client.get("/api/v1/uploads/v/annotation").json()
    assert [(t["origin"], t["confirmed"]) for t in annotation["tracks"]] == [("auto", False)]
    # 25 fps, 10 frame lấy mẫu mỗi giây: bước 2,5 làm tròn thành 2
    assert annotation["auto_label"]["sample_step"] == 2
    assert client.get("/api/v1/annotations/summary").json()["v"]["auto_pending"] == 1


def test_saving_labels_keeps_autolabel_info(client, fake_model, video):
    autolabel(client)
    tracks = client.get("/api/v1/uploads/v/annotation").json()["tracks"]

    client.put("/api/v1/uploads/v/annotation", json={"tracks": [{**tracks[0], "confirmed": True}]})

    body = client.get("/api/v1/uploads/v/annotation").json()
    assert body["auto_label"] is not None
    assert body["tracks"][0]["confirmed"] is True


def test_autolabel_refuses_to_overwrite_human_labels(client, annotation_store, fake_model, video):
    human = {"track_id": 1, "segments": [{"start": 0, "end": 10}], "keyframes": {}}
    annotation_store.save(Annotation(upload_id="v", tracks=[human]))

    assert autolabel(client).status_code == 409


def test_autolabel_replaces_previous_unconfirmed_result(client, fake_model, video):
    autolabel(client)
    autolabel(client)

    assert len(client.get("/api/v1/uploads/v/annotation").json()["tracks"]) == 1


def test_gt_blocks_unconfirmed_auto_tracks(client, store, fake_model, video):
    autolabel(client)

    checks = client.get("/api/v1/gt/readiness").json()["videos"]

    assert not checks[0]["eligible"]
    assert any("chưa được xác nhận" in i["message"] for i in checks[0]["issues"])


def test_autolabel_errors_are_reported(client, fake_model, video, monkeypatch):
    def broken(labels, min_score, model_file=None):
        raise RuntimeError("không nạp được model")

    monkeypatch.setattr(detector_module, "get_detector", broken)
    autolabel(client)

    status = client.get("/api/v1/uploads/v/autolabel").json()
    assert status["status"] == "error" and "không nạp được model" in status["error"]


def test_autolabel_needs_library(client, video, monkeypatch):
    monkeypatch.setattr(detector_module, "is_available", lambda: False)

    assert autolabel(client).status_code == 503


def test_autolabel_models_list_default_first(client):
    models = client.get("/api/v1/autolabel/models").json()
    assert models[0]["id"] == "yolo26s.pt" and models[0]["default"] is True
    assert "yolo26x.pt" in {m["id"] for m in models}
    assert "rtdetr-l.pt" not in {m["id"] for m in models}


def test_autolabel_with_chosen_model(client, fake_model, video):
    response = client.post("/api/v1/uploads/v/autolabel", json={"model": "yolo26x.pt"})
    assert response.status_code == 202
    assert response.json()["model"] == "yolo26x.pt"
    assert fake_model == ["yolo26x.pt"]
    annotation = client.get("/api/v1/uploads/v/annotation").json()
    assert annotation["auto_label"]["model"] == "Ultralytics yolo26x.pt (COCO)"


def test_autolabel_default_model_and_unknown_model(client, fake_model, video):
    assert client.post("/api/v1/uploads/v/autolabel").json()["model"] == "yolo26s.pt"
    assert fake_model == ["yolo26s.pt"]
    assert client.post("/api/v1/uploads/v/autolabel", json={"model": "khong-co.pt"}).status_code == 422
