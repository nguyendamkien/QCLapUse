"""Dependency dùng chung cho các endpoint (FastAPI Depends).

Mỗi store chỉ được tạo một lần (lru_cache) để mọi request dùng chung một đối tượng,
nhờ vậy lock bên trong store mới có tác dụng. Khi test, conftest.py thay các hàm
này bằng store trỏ vào thư mục tạm (app.dependency_overrides).
"""

from functools import lru_cache

from app.core.config import settings
from app.services.annotation_store import AnnotationStore
from app.services.eval_model_store import EvalModelStore
from app.services.eval_store import EvalStore
from app.services.gt_store import GtStore
from app.services.project_store import ProjectStore
from app.services.upload_store import UploadStore


@lru_cache
def get_upload_store() -> UploadStore:
    return UploadStore(settings.UPLOAD_DIR)


@lru_cache
def get_annotation_store() -> AnnotationStore:
    return AnnotationStore(settings.ANNOTATION_DIR)


@lru_cache
def get_gt_store() -> GtStore:
    return GtStore(settings.GT_DIR)


@lru_cache
def get_project_store() -> ProjectStore:
    # Nằm cạnh index.json của video vì project chỉ là cách gom các video lại
    return ProjectStore(settings.UPLOAD_DIR / "projects.json")


@lru_cache
def get_eval_store() -> EvalStore:
    return EvalStore(settings.EVAL_DIR)


@lru_cache
def get_eval_model_store() -> EvalModelStore:
    return EvalModelStore(settings.EVAL_MODEL_DIR)
