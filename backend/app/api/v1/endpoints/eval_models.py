"""API quản lý file model dùng để đánh giá.

POST   /eval-models          tải file trọng số lên (multipart: file, tuỳ chọn name), đọc danh sách lớp
GET    /eval-models          danh sách model, mới nhất trước
DELETE /eval-models/{id}     xoá model (các lượt đánh giá đã chạy vẫn giữ)
"""

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile, status

from app.api.deps import get_eval_model_store
from app.core.config import settings
from app.schemas.evaluation import EvalModel
from app.services import model_runner
from app.services.autolabel import detector
from app.services.eval_model_store import EvalModelStore

router = APIRouter(prefix="/eval-models")

MODEL_EXTENSIONS = {".pt", ".onnx"}
CHUNK_SIZE = 1024 * 1024


def require_model_library() -> None:
    if not detector.is_available():
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Máy chủ chưa cài thư viện chạy model. Chạy: pip install -r requirements-autolabel.txt",
        )


@router.get("", response_model=list[EvalModel])
def list_models(store: EvalModelStore = Depends(get_eval_model_store)):
    return store.list()


@router.post("", response_model=EvalModel, status_code=status.HTTP_201_CREATED)
def upload_model(
    file: UploadFile,
    name: str | None = Form(None),
    store: EvalModelStore = Depends(get_eval_model_store),
):
    require_model_library()
    filename = Path(file.filename or "").name
    extension = Path(filename).suffix.lower()
    if extension not in MODEL_EXTENSIONS:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Chỉ nhận file model Ultralytics (YOLO, RT-DETR): {', '.join(sorted(MODEL_EXTENSIONS))}.",
        )

    model_id = uuid.uuid4().hex
    destination = store.model_dir / f"{model_id}{extension}"
    limit = settings.MAX_MODEL_SIZE_MB * 1024 * 1024
    size = 0
    try:
        with destination.open("wb") as out:
            while chunk := file.file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(
                        status.HTTP_413_CONTENT_TOO_LARGE, f"File model vượt quá {settings.MAX_MODEL_SIZE_MB} MB."
                    )
                out.write(chunk)
        # Nạp thử để chắc file dùng được và biết model phát hiện những lớp nào
        classes = model_runner.read_classes(destination, filename)
    except ValueError as error:
        destination.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from error
    except BaseException:
        destination.unlink(missing_ok=True)
        raise

    model = EvalModel(
        id=model_id,
        name=(name or "").strip() or Path(filename).stem,
        filename=filename,
        stored_as=destination.name,
        size=size,
        created_at=datetime.now(timezone.utc),
        classes=classes,
    )
    store.add(model)
    return model


@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_model(model_id: str, store: EvalModelStore = Depends(get_eval_model_store)):
    if store.delete(model_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy model.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
