"""Cấu hình của backend.

Mỗi thuộc tính của Settings có thể ghi đè bằng biến môi trường cùng tên hoặc trong
file backend/.env, ví dụ: MAX_UPLOAD_SIZE_MB=10240
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Thư mục backend/ (file này nằm ở backend/app/core/config.py)
BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    PROJECT_NAME: str = "LapUse QC"
    API_V1_PREFIX: str = "/api/v1"
    # Origin của frontend được phép gọi API (Vite dev server chạy ở cổng 5173)
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    # Tạm thời lưu video vào thư mục này, sau sẽ chuyển sang object storage
    UPLOAD_DIR: Path = BACKEND_DIR / "storage" / "uploads"
    ANNOTATION_DIR: Path = BACKEND_DIR / "storage" / "annotations"
    GT_DIR: Path = BACKEND_DIR / "storage" / "gt"
    EVAL_DIR: Path = BACKEND_DIR / "storage" / "evaluations"
    # Giới hạn dung lượng file dự đoán tải lên ở trang Đánh giá model
    MAX_PREDICTION_SIZE_MB: int = 200
    # File trọng số model tải lên ở trang Đánh giá model
    EVAL_MODEL_DIR: Path = BACKEND_DIR / "storage" / "eval_models"
    MAX_MODEL_SIZE_MB: int = 1024
    # Giới hạn dung lượng mỗi video tải lên (5 GB)
    MAX_UPLOAD_SIZE_MB: int = 5120
    ALLOWED_VIDEO_EXTENSIONS: set[str] = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

    # Auto label: số frame được đưa vào detector mỗi giây video. Ít hơn thì chạy nhanh hơn
    # nhưng thời điểm bắt đầu / kết thúc đoạn kém chính xác hơn.
    AUTOLABEL_SAMPLES_PER_SECOND: float = 10
    # Model Ultralytics dùng cho auto label và thư mục chứa file trọng số (tự tải nếu chưa có)
    AUTOLABEL_MODEL: str = "yolo26s.pt"
    MODEL_DIR: Path = BACKEND_DIR / "storage" / "models"


settings = Settings()
