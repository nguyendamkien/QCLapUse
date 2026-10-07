# Cấu trúc backend

Backend của LapUse QC viết bằng FastAPI. Tài liệu này mô tả từng thư mục, từng file làm gì và các phần gọi nhau ra sao. Cài đặt và danh sách API xem ở [README](../README.md), luồng QC xem ở [doc/luong-qc.md](../doc/luong-qc.md).

## Cây thư mục

```
backend/
├── app/
│   ├── main.py                     # Khởi tạo FastAPI, bật CORS, gắn router /api/v1
│   ├── core/
│   │   └── config.py               # Cấu hình: thư mục lưu trữ, giới hạn dung lượng, CORS
│   ├── api/
│   │   ├── deps.py                 # Tạo các store dùng chung cho endpoint (Depends)
│   │   └── v1/
│   │       ├── router.py           # Gom router của các nhóm API
│   │       └── endpoints/
│   │           ├── uploads.py      # Tải lên, xem, phát, xoá video
│   │           ├── classification.py # Phân loại video
│   │           ├── projects.py     # Tạo / đổi tên / xoá project, chuyển video sang project
│   │           ├── annotations.py  # Đọc / lưu nhãn box
│   │           ├── autolabel.py    # Chạy auto label cho một video, xem tiến độ
│   │           ├── gt.py           # Xem trước GT của một video; API khoá version (không còn giao diện)
│   │           ├── evaluations.py  # Chạy đánh giá model, phân loại lỗi, báo cáo
│   │           └── eval_models.py  # Tải / xoá file model dùng để đánh giá
│   ├── schemas/                    # Kiểu dữ liệu (Pydantic): kiểm tra đầu vào, định dạng đầu ra
│   │   ├── upload.py               # Video, phân loại
│   │   ├── project.py              # Project (bộ video)
│   │   ├── annotation.py           # Nhãn: track, đoạn, keyframe, box
│   │   ├── autolabel.py            # Trạng thái job auto label
│   │   ├── gt.py                   # Ground truth
│   │   └── evaluation.py           # Lượt đánh giá, chỉ số, file dự đoán, báo cáo
│   ├── services/                   # Logic nghiệp vụ và lưu trữ, không phụ thuộc HTTP
│   │   ├── autolabel/
│   │   │   ├── detector.py         # Đọc frame bằng ffmpeg, chạy model YOLO26 / RT-DETR (ultralytics)
│   │   │   ├── pipeline.py         # Phát hiện → tracking → đang dùng? → đoạn → keyframe (hàm thuần)
│   │   │   ├── bytetrack.py        # Tracking người bằng ByteTrack của ultralytics (mặc định)
│   │   │   └── jobs.py             # Chạy nền từng video, giữ tiến độ, ghi kết quả vào file nhãn
│   │   ├── upload_store.py         # Lưu thông tin video vào index.json
│   │   ├── project_store.py        # Lưu danh sách project vào projects.json
│   │   ├── annotation_store.py     # Lưu nhãn, mỗi video một file JSON
│   │   ├── gt_store.py             # Lưu các version GT
│   │   ├── gt_builder.py           # Kiểm tra điều kiện và dựng nội dung GT
│   │   ├── evaluator.py            # Chấm kết quả dự đoán so với GT (hàm thuần)
│   │   ├── eval_store.py           # Lưu các lượt đánh giá
│   │   ├── eval_model_store.py     # Lưu file model tải lên
│   │   ├── model_runner.py         # Chạy model qua các frame được chấm của video
│   │   ├── eval_jobs.py            # Chạy đánh giá trong nền, theo dõi tiến độ
│   │   ├── track_interpolation.py  # Nội suy box giữa các keyframe
│   │   ├── video_probe.py          # Đọc metadata video bằng ffprobe
│   │   └── video_proxy.py          # Chuyển video trình duyệt không phát được sang MP4
│   ├── db/                         # Để trống, dành cho database sau này
│   └── models/                     # Để trống, dành cho model database sau này
├── storage/                        # Dữ liệu thật: video, nhãn, kết quả đánh giá, model (không commit)
├── tests/                          # Test tự động (pytest)
├── requirements.txt                # Thư viện Python cần cài
├── requirements-autolabel.txt      # Thư viện thêm cho auto label (ultralytics), tuỳ chọn
├── .env.example                    # Mẫu file cấu hình
└── cau-truc.md                     # Tài liệu này
```

## Các tầng và cách chúng gọi nhau

Code chia thành ba tầng. Tầng trên chỉ gọi tầng dưới, không gọi ngược lại.

```
Request HTTP
     │
     ▼
┌─────────────────────────┐  Nhận request, kiểm tra dữ liệu có tồn tại / hợp lệ (404, 409...),
│ api/v1/endpoints/*.py   │  gọi service, trả response. Không chứa logic nghiệp vụ phức tạp.
└───────────┬─────────────┘
            │ Depends(...) lấy store từ api/deps.py
            ▼
┌─────────────────────────┐  Logic nghiệp vụ (nội suy, dựng GT, chấm model, auto label)
│ services/*.py           │  và đọc / ghi file trong storage/. Không biết gì về HTTP,
└───────────┬─────────────┘  nên dùng lại được trong script hoặc test.
            │
            ▼
┌─────────────────────────┐  Kiểu dữ liệu dùng chung cho cả hai tầng trên. Pydantic tự
│ schemas/*.py            │  kiểm tra dữ liệu (ví dụ box nằm trong khung hình).
└─────────────────────────┘
```

**Ví dụ lưu nhãn** (`PUT /api/v1/uploads/{id}/annotation`):

1. FastAPI kiểm tra body theo `AnnotationIn` trong `schemas/annotation.py`. Box ra ngoài khung hình hoặc các đoạn chồng nhau thì trả lỗi 422 ngay, chưa chạy tới endpoint.
2. `Depends(get_upload_or_404)` tìm video; không có thì trả 404.
3. `save_annotation` trong `endpoints/annotations.py` gắn thêm `upload_id` và thời gian lưu.
4. `AnnotationStore.save` trong `services/annotation_store.py` ghi file `storage/annotations/<id>.json`.

## Chi tiết từng file

### Khởi động và cấu hình

| File | Chức năng |
| --- | --- |
| `app/main.py` | Tạo ứng dụng FastAPI, bật CORS cho frontend, gắn mọi API dưới tiền tố `/api/v1`. Đây là file uvicorn chạy: `uvicorn app.main:app`. |
| `app/core/config.py` | Lớp `Settings` chứa toàn bộ cấu hình, ghi đè được bằng biến môi trường hoặc file `.env`: thư mục lưu trữ (`UPLOAD_DIR`, `ANNOTATION_DIR`, `GT_DIR`, `EVAL_DIR`, `EVAL_MODEL_DIR`, `MODEL_DIR`), giới hạn dung lượng (`MAX_UPLOAD_SIZE_MB`, `MAX_MODEL_SIZE_MB`, `MAX_PREDICTION_SIZE_MB`), auto label (`AUTOLABEL_MODEL`, `AUTOLABEL_SAMPLES_PER_SECOND`), `ALLOWED_VIDEO_EXTENSIONS`, `CORS_ORIGINS`. Danh sách đầy đủ kèm giá trị mặc định ở README. |
| `app/api/deps.py` | `get_upload_store`, `get_annotation_store`, `get_gt_store`, `get_project_store`, `get_eval_store`, `get_eval_model_store`. Mỗi store chỉ tạo một lần (`lru_cache`) để mọi request dùng chung, nhờ vậy lock bên trong store mới có tác dụng. |
| `app/api/v1/router.py` | Gắn router của các nhóm API (mỗi file trong `endpoints/` một nhóm) vào `api_router`. Thêm nhóm API mới thì đăng ký ở đây. |

### Endpoints (tầng HTTP)

| File | API | Chức năng |
| --- | --- | --- |
| `uploads.py` | `GET/POST /uploads`, `GET/DELETE /uploads/{id}`, `GET /uploads/{id}/video`, `POST /uploads/{id}/proxy` | Nhận file theo từng khối 1 MB, từ chối file sai định dạng hoặc quá lớn, đọc metadata, phát video (hỗ trợ tua), xoá video cùng nhãn và bản xem. Có `get_upload_or_404` được các file khác dùng lại. |
| `classification.py` | `POST /uploads/classify` | Chuyển một hoặc nhiều video sang nhóm (có / không có người sử dụng) hoặc về "Chưa phân loại". Có `_get_all_or_404` được `projects.py` dùng lại. |
| `projects.py` | `GET/POST /projects`, `PATCH/DELETE /projects/{id}`, `POST /uploads/project` | Tạo project (tên không trùng, không phân biệt hoa thường), đổi tên, xoá (xoá luôn mọi video bên trong, dùng chung `remove_upload` với API xoá video), chuyển một hoặc nhiều video sang project khác. |
| `annotations.py` | `GET /annotations/summary`, `GET/PUT /uploads/{id}/annotation`, `GET /uploads/{id}/annotation/frames` | Đọc và ghi đè nhãn của một video; tóm tắt số người, trạng thái đã gán xong của mọi video (dùng cho danh sách ở trang Gán nhãn). |
| `autolabel.py` | `GET /autolabel/models`, `POST /uploads/{id}/autolabel`, `GET /uploads/{id}/autolabel` | Danh sách model chọn được (YOLO26s, YOLO26x). Bắt đầu auto label nền cho một video với model đã chọn (từ chối nếu đã có nhãn tay, chưa cài thư viện, video không có người sử dụng, hoặc model không có trong danh sách) và trả tiến độ. Router không có prefix để `/autolabel/models` không bị `/uploads/{upload_id}` bắt nhầm. |
| `eval_models.py` | `POST/GET /eval-models`, `DELETE /eval-models/{id}` | Nhận file trọng số `.pt` / `.onnx` (tối đa `MAX_MODEL_SIZE_MB`), nạp thử để đọc danh sách lớp, file hỏng thì xoá và báo lỗi. |
| `evaluations.py` | `POST /evaluations/run`, `GET /evaluations/jobs[/{id}]`, `POST/GET /evaluations`, `GET/DELETE /evaluations/{id}`, `GET /evaluations/{id}/download`, `PATCH /evaluations/{id}/videos/{upload_id}`, `PATCH /evaluations/{id}/report` | Chạy model đã tải lên qua video của project (nền, qua `eval_jobs.py`) hoặc nhận file kết quả JSON (tối đa `MAX_PREDICTION_SIZE_MB`); dựng GT từ nhãn hiện tại rồi chấm, lưu kết quả; QC lead phân loại lỗi từng video, viết nhận xét và duyệt báo cáo. Các route `/jobs` khai báo trước `/{run_id}`. |
| `gt.py` | `GET /gt/preview/{id}`, `GET /gt/readiness`, `GET/POST /gt`, `GET /gt/{version}`, `GET /gt/{version}/download` | Xem trước GT của một video (panel GT ở trang Gán nhãn). Các API kiểm tra và khoá version còn giữ nhưng không còn giao diện; khi đánh giá, GT được dựng lại từ nhãn hiện tại (`evaluator.py`). |

### Schemas (kiểu dữ liệu)

| File | Các kiểu chính |
| --- | --- |
| `upload.py` | `Upload`: một video (metadata, trạng thái bản xem, project, phân loại). `ClassifyIn`: body của API phân loại. `VideoGroup`: hai nhóm `using` / `not_using`. |
| `project.py` | `Project`: id, tên, thời gian tạo. `ProjectIn`: body tạo / đổi tên, bỏ khoảng trắng thừa. `MoveToProjectIn`: body chuyển video sang project. |
| `annotation.py` | `BoxGeometry`: box `x, y, w, h` chuẩn hoá 0–1. `Segment`: một đoạn frame. `Track`: một người, gồm các đoạn và keyframe; kiểm tra đoạn không chồng nhau, keyframe nằm trong đoạn. `AnnotationIn` / `Annotation`: nhãn của cả video, có cờ `done` (đã gán xong). |
| `evaluation.py` | `PredictionFile`, `PredBox`: file dự đoán. `EvalParams`: ngưỡng IoU, score, `frame_step`, số frame tối thiểu mức video. `Metrics` (tp, fp, fn, precision, recall, f1), `VideoConfusion`: chỉ số. `VideoResult`: kết quả và phân loại lỗi một video. `EvalRun` / `EvalRunInfo`: một lượt đầy đủ / tóm tắt. `EvalReport`: nhận xét và trạng thái duyệt. `EvalModel`: file model đã tải lên (tên, lớp). `EvalRunIn`, `EvalJob`: yêu cầu chạy model và trạng thái lần chạy nền. |
| `autolabel.py` | `AutoLabelJob`: trạng thái, tiến độ, model của lần chạy. `AutoLabelIn`: model muốn dùng. `AutoLabelModel`: một model trong danh sách chọn. |
| `gt.py` | `GtVideoCheck`, `GtIssue`: kết quả kiểm tra một video. `GtVideo`: phần GT của một video (`frames`, `events`, `ignore`). `GtVersion`: một version đầy đủ. `GtVersionInfo`: phần tóm tắt, dùng để liệt kê. `GtPreview`: GT xem trước. |

### Services (logic và lưu trữ)

| File | Hàm / lớp chính | Chức năng |
| --- | --- | --- |
| `upload_store.py` | `UploadStore`: `list`, `get`, `add`, `update`, `update_many`, `delete` | Lưu mọi bản ghi video trong `storage/uploads/index.json`. Dùng lock để request song song không ghi đè nhau, ghi qua file tạm để không làm hỏng file khi máy tắt giữa chừng. |
| `project_store.py` | `ProjectStore`: `list`, `get`, `find_by_name`, `add`, `update`, `delete` | Lưu các project trong `storage/uploads/projects.json`. Video thuộc project nào thì lưu ở `Upload.project_id`, không di chuyển file. |
| `annotation_store.py` | `AnnotationStore`: `get`, `save`, `delete`, `summaries` | Mỗi video một file `storage/annotations/<id>.json`. Tự chuyển file nhãn định dạng cũ (box theo từng frame) sang track khi đọc. |
| `evaluator.py` | `iou`, `evaluate_video`, `match_predictions`, `run_evaluation` | Ghép box dự đoán với box GT theo IoU tại các frame được chấm (box trong khoảng `ignore` không tính thừa), tính chỉ số mức box và mức video, gán khoá trong file dự đoán cho video theo id hoặc tên, đổi toạ độ pixel sang 0–1. |
| `model_runner.py` | `read_classes`, `load_predictor`, `predict_uploads` | Nạp model Ultralytics, lọc theo lớp đã chọn, chạy trên các frame được chấm (đọc bằng `iter_frames` của auto label) và trả box chuẩn hoá 0–1. |
| `eval_jobs.py` | `create`, `run_job`, `get`, `list_jobs`, `eligible_uploads` | Chạy model trong nền (chỉ trên video đủ điều kiện), cập nhật tiến độ, chấm xong thì lưu thành lượt đánh giá. Dùng chung `detector.inference_lock` với auto label. |
| `eval_model_store.py` | `EvalModelStore`: `list`, `get`, `add`, `delete`, `path` | Mỗi model một file trong `storage/eval_models/`, kèm `index.json`. |
| `eval_store.py` | `EvalStore`: `list`, `get`, `save`, `update`, `delete`, `path` | Mỗi lượt một file `storage/evaluations/<id>.json`. `update` đọc-sửa-ghi trong lock. Chỉ nhận id dạng hex. |
| `gt_store.py` | `GtStore`: `list`, `get`, `path`, `create` | Mỗi version một file `storage/gt/v<n>.json`, kèm `index.json` tóm tắt để liệt kê nhanh. `create` cấp số version kế tiếp trong lock. Version đã tạo không sửa được. |
| `gt_builder.py` | `check_video`, `build_video`, `build_version`, `total_frames` | `check_video` liệt kê vấn đề của một video (lỗi thì chặn, cảnh báo thì vẫn cho vào). `build_video` chuyển track, đoạn, keyframe thành `frames` (chỉ frame chia hết cho `frame_step`), `events` và `ignore`. `build_version` gom lại kèm thống kê. |
| `track_interpolation.py` | `box_at`, `expand_to_frames` | Tính box ở một frame bằng nội suy tuyến tính giữa hai keyframe gần nhất trong cùng đoạn. Frontend có logic giống vậy ở `frontend/src/labeling/tracks.js`. |
| `video_probe.py` | `probe_video`, `VideoInfo`, `InvalidVideoError` | Gọi `ffprobe` đọc thời lượng, fps, kích thước, codec. File không đọc được thì báo lỗi. Máy không có ffprobe thì trả thông tin rỗng. |
| `autolabel/pipeline.py` | `build_tracks`, `track_people`, `stitch_tracks`, `static_devices`, `is_using`, `runs_to_segments`, `select_keyframes` | Biến kết quả phát hiện ở các frame lấy mẫu thành track `origin=auto`, `confirmed=false`: nối người qua các frame bằng ByteTrack (`bytetrack.py`, mặc định) hoặc theo vị trí và ngoại hình (màu áo, quần) khi `Params.tracker = "appearance"`, xác định đang dùng laptop (laptop nằm ở phần thân trong box người), gộp thành đoạn (mỗi đoạn liên tục một track), chọn ít keyframe nhất. Mọi ngưỡng nằm trong `Params`. Không cần torch nên test bằng dữ liệu giả. |
| `autolabel/detector.py` | `Detector`, `get_detector`, `load_ultralytics`, `MODEL_CHOICES`, `list_models`, `iter_frames`, `is_available`, `inference_lock` | Mỗi model (trong `MODEL_CHOICES`: `yolo26s.pt` mặc định theo `AUTOLABEL_MODEL`, `yolo26x.pt`) nạp một lần rồi giữ lại; chưa có trọng số thì tự tải vào `storage/models/`. Tính đặc trưng ngoại hình (histogram màu HSV của áo, quần) cho từng người. `load_ultralytics` chọn lớp `RTDETR` khi tên file có "rtdetr", còn lại `YOLO`, dùng chung cho đánh giá model; đọc frame theo đúng số thứ tự của file gốc bằng ffmpeg. ultralytics chỉ được import khi chạy thật. |
| `autolabel/jobs.py` | `queue_job`, `run_job`, `get_job`, `has_human_work` | Chạy nền với model đã chọn, lấy mẫu `AUTOLABEL_SAMPLES_PER_SECOND` frame mỗi giây, cập nhật phần trăm tiến độ, không ghi đè nếu video đã có nhãn do người gán. Giữ `detector.inference_lock` trong lúc chạy nên không chạy song song với đánh giá model. |
| `video_proxy.py` | `needs_proxy`, `make_proxy`, `run_proxy_job`, `proxy_path` | Video trình duyệt không phát được (vỏ `.avi` / `.mkv`, hoặc codec khác H.264 / VP8 / VP9 / AV1) được chuyển nền sang `<id>.play.mp4` bằng `ffmpeg`, giữ nguyên từng frame để nhãn vẫn khớp với file gốc. |

## Dữ liệu trong `storage/`

```
storage/
├── uploads/
│   ├── index.json            # Danh sách bản ghi Upload của mọi video
│   ├── projects.json         # Danh sách project
│   ├── <id>.mp4 / .avi ...   # File video gốc, đặt tên theo id ngẫu nhiên
│   └── <id>.play.mp4         # Bản xem MP4, chỉ có với video trình duyệt không phát được
├── annotations/
│   └── <id>.json             # Nhãn của một video
├── evaluations/
│   └── <id>.json             # Một lượt đánh giá: tham số, chỉ số, kết quả từng video, báo cáo
├── eval_models/
│   ├── index.json            # Danh sách model đã tải lên (tên, tên file gốc, lớp)
│   └── <id>.pt / .onnx       # File trọng số
├── models/                   # Trọng số auto label (yolo26s.pt, yolo26x.pt), tự tải lần đầu
└── gt/
    ├── index.json            # Tóm tắt các version (API cũ, không còn giao diện)
    └── v1.json, v2.json ...  # Nội dung từng version GT
```

Thư mục này nằm trong `.gitignore`. Muốn đổi chỗ lưu thì sửa các biến `*_DIR` trong `.env`.

## Tests

| File | Kiểm tra |
| --- | --- |
| `conftest.py` | Fixture dùng chung: thay các store bằng store trỏ vào thư mục tạm (`app.dependency_overrides`), nên test không động tới `storage/` thật; tạo video thử bằng ffmpeg. |
| `test_uploads.py` | Tải lên, từ chối sai định dạng / file hỏng / quá lớn, xoá. |
| `test_projects.py` | Tạo, đổi tên, tên trùng, chuyển video giữa các project, xoá project xoá luôn video bên trong nhưng không đụng video ngoài project, tải video vào project. |
| `test_classification.py` | Phân loại nhiều video, nhóm không hợp lệ, đưa về chưa phân loại, API review đã bỏ. |
| `test_annotations.py` | Lưu và đọc nhãn, các trường hợp nhãn không hợp lệ, cờ đã gán xong. |
| `test_eval_models.py` | Tải / xoá model, file sai loại hoặc hỏng, thiếu thư viện; chạy model giả qua project và chấm, chỉ chạy trên video đủ điều kiện, báo lỗi khi chạy hỏng. |
| `test_evaluations.py` | IoU, chấm đúng hết, box thừa / bỏ sót, khoảng ignore, ngưỡng score và IoU, khớp theo tên file và toạ độ pixel, file sai định dạng, phân loại lỗi, báo cáo, xoá. |
| `test_gt.py` | Điều kiện chặn và cảnh báo, nội dung GT, version là bản sao cố định, xem trước. |
| `test_autolabel.py` | Tracking theo vị trí và ngoại hình, ByteTrack (giữ người qua frame điểm thấp, không tạo track từ box điểm thấp), thiết bị cố định, tạo đoạn, mỗi đoạn liên tục một track, chọn keyframe; API với detector giả: ghi track chưa xác nhận, không ghi đè nhãn tay, GT chặn track chưa xác nhận, chọn model, model không có trong danh sách. |
| `test_video_proxy.py` | `.avi` MJPEG được chuyển sang H.264 với đúng số frame, video cũ được chuyển khi mở, báo lỗi và thử lại. |

Chạy test: `cd backend` rồi `pytest`. Một số test cần `ffmpeg` và `ffprobe`; máy không có thì các test đó tự bỏ qua.

## Thêm một nhóm API mới

1. Khai báo kiểu dữ liệu trong `schemas/`.
2. Viết logic trong `services/`. Nếu cần lưu dữ liệu thì tạo một store mới theo mẫu của `upload_store.py`, và thêm hàm `get_..._store` vào `api/deps.py`.
3. Tạo file trong `api/v1/endpoints/` với `router = APIRouter(prefix="/...")`.
4. Đăng ký router trong `api/v1/router.py`.
5. Viết test trong `tests/`. Nếu có store mới thì thêm override cho nó trong `conftest.py`.
