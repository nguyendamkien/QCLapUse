import json
from datetime import datetime, timezone

import pytest

from app.schemas.annotation import Annotation
from app.schemas.upload import Upload
from app.services.evaluator import iou

# Giống test_gt.py: video 2 giây, 10 fps = 20 frame; chấm frame 0, 5, 10, 15
A = (0.1, 0.2, 0.2, 0.4)
B = (0.3, 0.2, 0.2, 0.4)
MID = (0.2, 0.2, 0.2, 0.4)  # box nội suy ở frame 10, giữa A (frame 5) và B (frame 15)
BOX = lambda b: {"x": b[0], "y": b[1], "w": b[2], "h": b[3]}  # noqa: E731


def add_video(store, upload_id, group, project_id):
    store.add(
        Upload(
            id=upload_id,
            name=f"{upload_id}.mp4",
            size=1,
            duration=2.0,
            fps=10.0,
            width=640,
            height=360,
            stored_as=f"{upload_id}.mp4",
            created_at=datetime.now(timezone.utc),
            project_id=project_id,
            group=group,
        )
    )


@pytest.fixture
def project(client, store, annotation_store):
    project = client.post("/api/v1/projects", json={"name": "Kho"}).json()
    pid = project["id"]
    add_video(store, "pos", "using", pid)
    # Người #1 có mặt frame 2 đến 17, box vẽ ở frame 5 và 15: frame 2-4 và 16-17 là ignore
    annotation_store.save(
        Annotation(
            upload_id="pos",
            tracks=[{"track_id": 1, "segments": [{"start": 2, "end": 17}], "keyframes": {5: BOX(A), 15: BOX(B)}}],
            done=True,
        )
    )
    add_video(store, "neg", "not_using", pid)
    add_video(store, "new", None, pid)
    add_video(store, "other", "not_using", None)  # ngoài project, không được chấm
    return project


def run(client, project, videos, model="m1", **params):
    body = json.dumps({"model": model, "videos": videos}).encode()
    return client.post(
        "/api/v1/evaluations",
        files={"file": ("pred.json", body, "application/json")},
        data={"project_id": project["id"], **{k: str(v) for k, v in params.items()}},
    )


def boxes(*bbs, score=0.9):
    return [{"bbox": list(b), "score": score} for b in bbs]


def by_id(result):
    return {v["upload_id"]: v for v in result["videos"]}


def test_iou():
    assert iou(A, A) == pytest.approx(1)
    assert iou(A, (0.5, 0.5, 0.1, 0.1)) == 0
    # Hai box lệch nhau nửa chiều rộng: giao 1/2, hợp 3/2 diện tích một box
    assert iou((0, 0, 0.2, 0.2), (0.1, 0, 0.2, 0.2)) == pytest.approx(1 / 3)


def test_perfect_predictions(client, project):
    result = run(client, project, {"pos": {"5": boxes(A), "10": boxes(MID), "15": boxes(B)}})

    assert result.status_code == 201
    body = result.json()
    assert (body["box"]["tp"], body["box"]["fp"], body["box"]["fn"]) == (3, 0, 0)
    assert body["box"]["precision"] == 1 and body["box"]["recall"] == 1
    # Mức video: pos có box ở 3 frame (>= 3) nên báo có người; neg không có box
    assert body["video"] == {"tp": 1, "fp": 0, "fn": 0, "tn": 1, "accuracy": 1.0}
    assert body["error_video_count"] == 0
    # Video chưa phân loại bị bỏ qua, video ngoài project không có mặt
    assert [s["upload_id"] for s in body["skipped"]] == ["new"]
    assert set(by_id(body)) == {"pos", "neg"}


def test_missed_and_false_boxes(client, project):
    far = (0.7, 0.1, 0.1, 0.1)
    body = run(
        client,
        project,
        {
            "pos": {"5": boxes(A, far), "15": boxes(B)},  # thiếu frame 10, thừa một box ở frame 5
            "neg": {"0": boxes(A), "5": boxes(A)},  # video không có người: box nào cũng thừa
        },
    ).json()
    videos = by_id(body)

    assert (videos["pos"]["box"]["tp"], videos["pos"]["box"]["fp"], videos["pos"]["box"]["fn"]) == (2, 1, 1)
    assert videos["pos"]["error_frames"] == [5, 10]
    assert videos["neg"]["box"]["fp"] == 2
    assert body["box_by_group"]["not_using"]["fp"] == 2
    # pos chỉ có 2 frame có box (< 3) nên mức video bị tính là bỏ sót
    assert body["video"]["fn"] == 1
    assert body["error_video_count"] == 2


def test_boxes_in_ignore_range_do_not_count(client, project):
    # Frame 15 khớp B; box ở frame 16-17 không được chấm vì không chia hết cho frame_step.
    # Với frame_step = 1, frame 3 nằm trong khoảng ignore 2-4 nên box ở đó không tính là thừa.
    body = run(client, project, {"pos": {"3": boxes(A), "5": boxes(A)}}, frame_step=1).json()
    assert by_id(body)["pos"]["box"]["fp"] == 0


def test_score_and_iou_thresholds(client, project):
    low = run(client, project, {"pos": {"5": boxes(A, score=0.3)}}).json()
    assert by_id(low)["pos"]["box"]["tp"] == 0

    loose = run(client, project, {"pos": {"5": boxes((0.15, 0.2, 0.2, 0.4))}}, iou_threshold=0.3).json()
    strict = run(client, project, {"pos": {"5": boxes((0.15, 0.2, 0.2, 0.4))}}, iou_threshold=0.9).json()
    assert by_id(loose)["pos"]["box"]["tp"] == 1
    assert by_id(strict)["pos"]["box"]["tp"] == 0


def test_match_by_file_name_pixels_and_unknown_keys(client, project):
    body = json.dumps(
        {
            "normalized": False,
            "videos": {"pos.mp4": {"5": [{"bbox": [64, 72, 128, 144], "score": 1}]}, "khong-co.mp4": {}},
        }
    ).encode()
    result = client.post(
        "/api/v1/evaluations",
        files={"file": ("pred.json", body, "application/json")},
        data={"project_id": project["id"]},
    ).json()

    assert by_id(result)["pos"]["box"]["tp"] == 1
    assert by_id(result)["neg"]["in_prediction_file"] is False
    assert result["unmatched_prediction_keys"] == ["khong-co.mp4"]


def test_rejects_bad_input(client, project):
    bad_json = client.post(
        "/api/v1/evaluations",
        files={"file": ("pred.json", b"{not json", "application/json")},
        data={"project_id": project["id"]},
    )
    assert bad_json.status_code == 422
    assert run(client, project, {"pos": {"5": [{"score": 1}]}}).status_code == 422
    assert run(client, {"id": "missing"}, {}).status_code == 404
    assert run(client, project, {}, iou_threshold=2).status_code == 422


def test_review_report_list_and_delete(client, project):
    first = run(client, project, {"pos": {"5": boxes(A)}}, model="v1").json()
    second = run(client, project, {"pos": {"5": boxes(A)}}, model="v2").json()

    listed = client.get("/api/v1/evaluations", params={"project_id": project["id"]}).json()
    assert [r["id"] for r in listed] == [second["id"], first["id"]]
    assert "videos" not in listed[0]

    reviewed = client.patch(
        f"/api/v1/evaluations/{first['id']}/videos/pos", json={"review": "label_error", "note": " Thiếu box "}
    ).json()
    assert (by_id(reviewed)["pos"]["review"], by_id(reviewed)["pos"]["note"]) == ("label_error", "Thiếu box")
    assert client.patch(f"/api/v1/evaluations/{first['id']}/videos/zzz", json={"review": "ok"}).status_code == 422

    report = client.patch(
        f"/api/v1/evaluations/{first['id']}/report", json={"summary_note": "Cần thêm dữ liệu", "status": "approved"}
    ).json()["report"]
    assert report["status"] == "approved" and report["approved_at"] and report["summary_note"] == "Cần thêm dữ liệu"

    assert client.get(f"/api/v1/evaluations/{first['id']}/download").status_code == 200
    assert client.delete(f"/api/v1/evaluations/{first['id']}").status_code == 204
    assert client.get(f"/api/v1/evaluations/{first['id']}").status_code == 404
    assert client.get("/api/v1/evaluations/..%2Fx").status_code == 404
