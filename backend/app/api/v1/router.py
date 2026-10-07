"""Gom router của từng nhóm API vào một chỗ.

Mỗi file trong endpoints/ là một nhóm; tags dùng để nhóm các API trên trang /docs.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import (
    annotations,
    autolabel,
    classification,
    eval_models,
    evaluations,
    gt,
    projects,
    uploads,
)

api_router = APIRouter()
api_router.include_router(uploads.router, tags=["uploads"])
api_router.include_router(classification.router, tags=["classification"])
api_router.include_router(projects.router, tags=["projects"])
api_router.include_router(annotations.router, tags=["annotations"])
api_router.include_router(autolabel.router, tags=["autolabel"])
api_router.include_router(gt.router, tags=["gt"])
api_router.include_router(evaluations.router, tags=["evaluations"])
api_router.include_router(eval_models.router, tags=["evaluations"])
