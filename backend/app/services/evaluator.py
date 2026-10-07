"""Chấm kết quả dự đoán của model so với GT (bước 5 của luồng QC).

Hàm thuần, không đọc ghi file, để dễ test. Cách chấm:

Mức box, tại mỗi frame được chấm (chia hết cho frame_step):
    - Bỏ box dự đoán có score dưới score_threshold, rồi ghép lần lượt box có score cao nhất
      với box GT chưa ghép có IoU lớn nhất. IoU >= iou_threshold là true positive.
    - Box dự đoán không ghép được là false positive, trừ khi frame nằm trong khoảng ignore của GT
      (có người nhưng chưa biết vị trí box) thì không tính.
    - Box GT không được ghép là false negative.
    - Video không có người sử dụng: mọi box dự đoán đều là false positive.

Mức video: model báo "có người sử dụng" khi có ít nhất min_frames_video frame được chấm có box.
"""

from collections.abc import Callable
from datetime import datetime, timezone

from app.schemas.annotation import Annotation
from app.schemas.evaluation import (
    EvalParams,
    EvalReport,
    EvalRun,
    Metrics,
    PredBox,
    PredictionFile,
    SkippedVideo,
    VideoConfusion,
    VideoResult,
)
from app.schemas.gt import GtVideo
from app.schemas.upload import Upload
from app.services.gt_builder import build_video, check_video

MAX_ERROR_FRAMES = 50


def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    inter_w = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    inter_h = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    inter = inter_w * inter_h
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def evaluate_video(gt: GtVideo, predictions: dict[int, list[PredBox]] | None, params: EvalParams) -> VideoResult:
    predictions = predictions or {}
    ignore = [(r.start, r.end) for r in gt.ignore]
    metrics = Metrics()
    error_frames: list[int] = []
    frames_with_prediction = 0
    frames_evaluated = 0

    for frame in range(0, gt.total_frames, params.frame_step):
        frames_evaluated += 1
        preds = sorted(
            (p for p in predictions.get(frame, []) if p.score >= params.score_threshold),
            key=lambda p: p.score,
            reverse=True,
        )
        truth = [box.bbox for box in gt.frames.get(frame, [])]
        if preds:
            frames_with_prediction += 1

        matched: set[int] = set()
        unmatched_preds = 0
        for pred in preds:
            best, best_index = 0.0, None
            for i, box in enumerate(truth):
                if i in matched:
                    continue
                overlap = iou(pred.bbox, box)
                if overlap > best:
                    best, best_index = overlap, i
            if best_index is not None and best >= params.iou_threshold:
                matched.add(best_index)
            else:
                unmatched_preds += 1

        in_ignore = any(start <= frame <= end for start, end in ignore)
        fp = 0 if in_ignore else unmatched_preds
        fn = len(truth) - len(matched)
        metrics.tp += len(matched)
        metrics.fp += fp
        metrics.fn += fn
        if (fp or fn) and len(error_frames) < MAX_ERROR_FRAMES:
            error_frames.append(frame)

    return VideoResult(
        upload_id=gt.upload_id,
        name=gt.name,
        group=gt.group,
        predicted_using=frames_with_prediction >= params.min_frames_video,
        frames_evaluated=frames_evaluated,
        frames_with_prediction=frames_with_prediction,
        box=metrics,
        error_frames=error_frames,
    )


def _to_normalized(boxes_by_frame: dict[int, list[PredBox]], upload: Upload) -> dict[int, list[PredBox]]:
    """Đổi box tính theo pixel sang toạ độ 0 đến 1 theo kích thước khung hình của video."""
    if not upload.width or not upload.height:
        raise ValueError(f'Chưa biết kích thước khung hình của "{upload.name}" nên không đổi được toạ độ pixel.')
    w, h = upload.width, upload.height
    return {
        frame: [
            PredBox(bbox=(b.bbox[0] / w, b.bbox[1] / h, b.bbox[2] / w, b.bbox[3] / h), score=b.score)
            for b in boxes
        ]
        for frame, boxes in boxes_by_frame.items()
    }


def match_predictions(
    uploads: list[Upload], prediction: PredictionFile
) -> tuple[dict[str, dict[int, list[PredBox]]], list[str]]:
    """Gán từng khoá trong file dự đoán cho một video: theo id, không có thì theo tên file.

    Trả (box theo id video, các khoá không khớp video nào hoặc trùng tên nhiều video).
    """
    by_id = {u.id: u for u in uploads}
    by_name: dict[str, list[Upload]] = {}
    for u in uploads:
        by_name.setdefault(u.name, []).append(u)

    matched: dict[str, dict[int, list[PredBox]]] = {}
    unmatched: list[str] = []
    for key, boxes in prediction.videos.items():
        upload = by_id.get(key)
        if upload is None and len(by_name.get(key, [])) == 1:
            upload = by_name[key][0]
        if upload is None:
            unmatched.append(key)
            continue
        matched[upload.id] = boxes if prediction.normalized else _to_normalized(boxes, upload)
    return matched, unmatched


def _sum(results: list[VideoResult]) -> Metrics:
    return Metrics(
        tp=sum(r.box.tp for r in results),
        fp=sum(r.box.fp for r in results),
        fn=sum(r.box.fn for r in results),
    )


def run_evaluation(
    *,
    run_id: str,
    name: str,
    project_id: str,
    project_name: str,
    uploads: list[Upload],
    get_annotation: Callable[[str], Annotation],
    prediction: PredictionFile,
    params: EvalParams,
) -> EvalRun:
    """Dựng GT từ nhãn hiện tại của các video trong project rồi chấm. GT được chụp lại trong kết quả."""
    matched, unmatched_keys = match_predictions(uploads, prediction)

    results: list[VideoResult] = []
    skipped: list[SkippedVideo] = []
    for upload in sorted(uploads, key=lambda u: u.name):
        if not upload.group:
            skipped.append(SkippedVideo(upload_id=upload.id, name=upload.name, reason="Chưa phân loại."))
            continue
        annotation = get_annotation(upload.id)
        check = check_video(upload, annotation)
        if not check.eligible:
            reason = next(i.message for i in check.issues if i.level == "error")
            skipped.append(SkippedVideo(upload_id=upload.id, name=upload.name, reason=reason))
            continue
        gt = build_video(upload, annotation, params.frame_step)
        result = evaluate_video(gt, matched.get(upload.id), params)
        result.in_prediction_file = upload.id in matched
        results.append(result)

    video = VideoConfusion()
    for r in results:
        actual = r.group == "using"
        if actual and r.predicted_using:
            video.tp += 1
        elif actual:
            video.fn += 1
        elif r.predicted_using:
            video.fp += 1
        else:
            video.tn += 1

    return EvalRun(
        id=run_id,
        name=name,
        project_id=project_id,
        project_name=project_name,
        model=prediction.model,
        created_at=datetime.now(timezone.utc),
        params=params,
        box=_sum(results),
        box_by_group={g: _sum([r for r in results if r.group == g]) for g in ("using", "not_using")},
        video=video,
        video_count=len(results),
        error_video_count=sum(1 for r in results if r.has_error),
        report=EvalReport(),
        videos=results,
        skipped=skipped,
        unmatched_prediction_keys=unmatched_keys,
    )
