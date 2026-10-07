"""Điểm khởi động của backend.

Chạy bằng: uvicorn app.main:app --reload --port 8000
Tài liệu API tự sinh ở http://localhost:8000/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings

app = FastAPI(title=settings.PROJECT_NAME)

# Cho phép frontend ở origin khác gọi API. Khi chạy dev qua proxy của Vite
# (localhost:5173/api -> localhost:8000) thì request cùng origin nên không cần tới.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mọi API nằm dưới tiền tố /api/v1
app.include_router(api_router, prefix=settings.API_V1_PREFIX)
