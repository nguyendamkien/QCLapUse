"""API phân loại video (bước 2 của luồng QC, xem doc/luong-qc.md).

POST /uploads/classify   chuyển một hoặc nhiều video sang nhóm khác (có / không có người sử dụng)

Phân loại lưu ngay trong bản ghi video (index.json), không di chuyển file trên đĩa.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_upload_store
from app.schemas.upload import ClassifyIn, Upload
from app.services.upload_store import UploadStore

router = APIRouter(prefix="/uploads")


def _get_all_or_404(store: UploadStore, upload_ids: list[str]) -> list[Upload]:
    uploads = {u.id: u for u in store.list()}
    missing = [i for i in upload_ids if i not in uploads]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Không tìm thấy {len(missing)} video: {', '.join(missing)}.")
    # dict.fromkeys bỏ id trùng nhưng vẫn giữ đúng thứ tự gửi lên
    return [uploads[i] for i in dict.fromkeys(upload_ids)]


@router.post("/classify", response_model=list[Upload])
def classify(data: ClassifyIn, store: UploadStore = Depends(get_upload_store)):
    """Chuyển video sang folder khác. group = None để đưa về "Chưa phân loại"."""
    classified = data.group is not None
    updated = [
        upload.model_copy(
            update={
                "group": data.group,
                "classified_at": datetime.now(timezone.utc) if classified else None,
            }
        )
        for upload in _get_all_or_404(store, data.upload_ids)
    ]
    store.update_many(updated)
    return updated
