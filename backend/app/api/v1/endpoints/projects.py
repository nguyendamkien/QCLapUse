"""API project: gom video thành từng bộ ở trang Tải dữ liệu, trang Gán nhãn lọc theo bộ.

GET    /projects            danh sách project, cũ nhất trước
POST   /projects            tạo project mới (tên không trùng)
PATCH  /projects/{id}       đổi tên
DELETE /projects/{id}       xoá project cùng mọi video bên trong (file gốc, bản xem, nhãn)
POST   /uploads/project     chuyển một hoặc nhiều video sang project khác

Project chỉ là nhãn gắn trên video (Upload.project_id), không di chuyển file trên đĩa.
"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.deps import get_annotation_store, get_project_store, get_upload_store
from app.api.v1.endpoints.classification import _get_all_or_404
from app.api.v1.endpoints.uploads import remove_upload
from app.schemas.project import MoveToProjectIn, Project, ProjectIn
from app.schemas.upload import Upload
from app.services.annotation_store import AnnotationStore
from app.services.project_store import ProjectStore
from app.services.upload_store import UploadStore

router = APIRouter()


def get_project_or_404(project_id: str, store: ProjectStore = Depends(get_project_store)) -> Project:
    project = store.get(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy project.")
    return project


def _check_name_free(store: ProjectStore, name: str, current_id: str | None = None) -> None:
    same = store.find_by_name(name)
    if same is not None and same.id != current_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f'Đã có project tên "{same.name}".')


@router.get("/projects", response_model=list[Project])
def list_projects(store: ProjectStore = Depends(get_project_store)):
    return store.list()


@router.post("/projects", response_model=Project, status_code=status.HTTP_201_CREATED)
def create_project(data: ProjectIn, store: ProjectStore = Depends(get_project_store)):
    _check_name_free(store, data.name)
    project = Project(id=uuid.uuid4().hex, name=data.name, created_at=datetime.now(timezone.utc))
    store.add(project)
    return project


@router.patch("/projects/{project_id}", response_model=Project)
def rename_project(
    data: ProjectIn,
    project: Project = Depends(get_project_or_404),
    store: ProjectStore = Depends(get_project_store),
):
    _check_name_free(store, data.name, project.id)
    updated = project.model_copy(update={"name": data.name})
    store.update(updated)
    return updated


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project: Project = Depends(get_project_or_404),
    store: ProjectStore = Depends(get_project_store),
    uploads: UploadStore = Depends(get_upload_store),
    annotations: AnnotationStore = Depends(get_annotation_store),
):
    # Xoá cả video trong project: bản ghi, file gốc, bản xem MP4 và nhãn
    for upload in uploads.list():
        if upload.project_id == project.id:
            remove_upload(uploads, annotations, upload.id)
    store.delete(project.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/uploads/project", response_model=list[Upload])
def move_to_project(
    data: MoveToProjectIn,
    projects: ProjectStore = Depends(get_project_store),
    uploads: UploadStore = Depends(get_upload_store),
):
    if data.project_id is not None and projects.get(data.project_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy project.")
    updated = [
        u.model_copy(update={"project_id": data.project_id}) for u in _get_all_or_404(uploads, data.upload_ids)
    ]
    uploads.update_many(updated)
    return updated
