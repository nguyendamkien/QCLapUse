"""API đọc / lưu nhãn (box người đang sử dụng laptop) của từng video.

GET /annotations/summary              số người, case, trạng thái xong của mọi video đã gán
GET /uploads/{id}/annotation          nhãn của một video (chưa gán thì trả nhãn rỗng)
PUT /uploads/{id}/annotation          ghi đè toàn bộ nhãn; frontend gọi khi tự lưu
GET /uploads/{id}/annotation/frames   box của từng frame sau khi nội suy
"""

import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_annotation_store
from app.api.v1.endpoints.uploads import get_upload_or_404
from app.schemas.annotation import Annotation, AnnotationIn, AnnotationSummary, FrameBox
from app.schemas.upload import Upload
from app.services.annotation_store import AnnotationStore
from app.services.track_interpolation import expand_to_frames

router = APIRouter()


@router.get("/annotations/summary", response_model=dict[str, AnnotationSummary])
def annotation_summaries(annotations: AnnotationStore = Depends(get_annotation_store)):
    return annotations.summaries()


@router.get("/uploads/{upload_id}/annotation", response_model=Annotation)
def get_annotation(
    upload: Upload = Depends(get_upload_or_404),
    annotations: AnnotationStore = Depends(get_annotation_store),
):
    return annotations.get(upload.id)


@router.put("/uploads/{upload_id}/annotation", response_model=Annotation)
def save_annotation(
    data: AnnotationIn,
    upload: Upload = Depends(get_upload_or_404),
    annotations: AnnotationStore = Depends(get_annotation_store),
):
    # Dữ liệu gửi lên đã được Pydantic kiểm tra (box trong khung hình, đoạn không chồng nhau...)
    annotation = Annotation(
        **data.model_dump(),
        upload_id=upload.id,
        updated_at=datetime.now(timezone.utc),
        auto_label=annotations.get(upload.id).auto_label,
    )
    annotations.save(annotation)
    return annotation


@router.get("/uploads/{upload_id}/annotation/frames", response_model=dict[int, list[FrameBox]])
def annotation_frames(
    upload: Upload = Depends(get_upload_or_404),
    annotations: AnnotationStore = Depends(get_annotation_store),
):
    """Box của mọi frame sau khi nội suy các track, dùng cho bước tạo GT."""
    if not upload.fps or not upload.duration:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Chưa có fps hoặc thời lượng của video. Hãy mở video ở trang Gán nhãn một lần để đọc bổ sung.",
        )
    total_frames = math.floor(upload.duration * upload.fps)
    return expand_to_frames(annotations.get(upload.id), total_frames)
