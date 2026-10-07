# LapUse QC

Ứng dụng web phục vụ luồng QC (kiểm soát chất lượng) cho dữ liệu và model **phát hiện người đang sử dụng laptop** trong video (CCTV, camera văn phòng…). "Sử dụng" gồm mọi tư thế tương tác với laptop: ngồi gõ phím, cầm trên tay, ôm hoặc mang máy khi đang dùng.

Tài liệu liên quan:

- [doc/luong-qc.md](doc/luong-qc.md): luồng QC (các bước, vai trò, ngưỡng chấp nhận)
- [doc/auto-label.md](doc/auto-label.md): auto label (model đề xuất nhãn nháp)
- [doc/tien-do.md](doc/tien-do.md): tiến độ, việc chờ quyết định, việc tiếp theo
- [backend/cau-truc.md](backend/cau-truc.md): cấu trúc code backend

## Tính năng

| Mục trên sidebar | Đường dẫn | Làm được gì |
| --- | --- | --- |
| Tổng quan | `/overview` | Xem theo tất cả hoặc một project: số video và thời lượng, % đã phân loại, % đã gán nhãn, số video chờ xác nhận auto label; tiến độ Phân loại → Gán nhãn; bảng theo project (thanh chia nhóm, tiến độ gán nhãn, nút Mở / Gán nhãn); danh sách việc cần xử lý |
| Tải dữ liệu | `/upload` | Tạo project (hiện dạng icon folder); tải video, tải cả thư mục hoặc kéo thả; chọn project để lưu sau khi tải; kiểm tra định dạng và file hỏng. **Mở một project để phân loại** video trong đó: folder theo nhóm, kéo thả giữa các folder, phân loại nhanh bằng phím tắt, chuyển video sang project khác, xoá |
| Gán nhãn | `/labeling` | Chọn project; đánh dấu đoạn thời gian mỗi người dùng laptop, vẽ box ở keyframe (các frame giữa tự nội suy), tự lưu, phím tắt; **auto label** bằng YOLO26s hoặc YOLO26x rồi xác nhận / sửa; xem trước phần GT của video |
| Đánh giá | `/evaluation` | Tải model (.pt / .onnx) và chạy qua video của project trên máy chủ, hoặc chấm từ file kết quả JSON có sẵn. Mỗi lượt có 3 tab: **Kết quả** (precision, recall, F1 mức box, mức video, theo nhóm), **Ca lỗi** (phân loại lỗi do nhãn hay do model, mở frame lỗi ở trang Gán nhãn), **Báo cáo** (so với ngưỡng và lượt trước, biểu đồ xu hướng, đề xuất, nhận xét và duyệt của QC lead, in / lưu PDF) |

Đường dẫn cũ vẫn dùng được: `/classify` chuyển về `/upload`, `/reports?run=` chuyển sang tab Báo cáo của lượt đó.

## Công nghệ

- **Backend:** Python 3.11+, FastAPI, Pydantic v2, pydantic-settings, Uvicorn, pytest
- **Frontend:** React 19, React Router 7, Vite 7
- **Lưu trữ:** file JSON và video trên đĩa (`backend/storage/`), chưa có database
- **FFmpeg** (`ffmpeg`, `ffprobe`): đọc metadata video, chuyển video sang MP4 để xem, đọc frame cho auto label và đánh giá model
- **Ultralytics** (tuỳ chọn): YOLO26 cho auto label; YOLO / RT-DETR khi chạy model để đánh giá

## Cấu trúc thư mục

```
HumanLaptop/
├── backend/                        # FastAPI, chi tiết ở backend/cau-truc.md
│   ├── app/
│   │   ├── api/v1/endpoints/       # uploads, classification, projects, annotations, autolabel,
│   │   │                           # gt, evaluations, eval_models
│   │   ├── schemas/                # Kiểu dữ liệu (Pydantic)
│   │   └── services/               # Logic và lưu trữ; autolabel/ là pipeline auto label
│   ├── storage/                    # Video, nhãn, kết quả đánh giá, model (không commit)
│   ├── tests/                      # pytest
│   ├── requirements.txt
│   └── requirements-autolabel.txt  # ultralytics, tuỳ chọn
├── frontend/
│   ├── public/favicon.svg          # Logo
│   └── src/
│       ├── api/client.js           # Gọi API backend
│       ├── pages/                  # Mỗi mục sidebar một trang
│       ├── components/
│       │   ├── upload/             # Icon folder, hộp thoại chọn nơi lưu, đặt tên project
│       │   ├── classification/     # Phân loại trong project, phân loại nhanh
│       │   ├── labeling/           # Canvas vẽ box, thanh tua frame, danh sách video, panel GT
│       │   ├── evaluation/         # Form chạy đánh giá, tab Kết quả / Ca lỗi / Báo cáo
│       │   ├── BrandLogo.jsx       # Logo trên sidebar (giữ khớp với favicon.svg)
│       │   └── Sidebar.jsx
│       ├── classification/         # Hai nhóm phân loại, đoán nhóm từ tên thư mục
│       ├── labeling/               # Màu track, logic track phía client
│       └── evaluation/             # Ngưỡng đạt, tham số mặc định
├── data/samples/                   # Video mẫu để thử (không commit)
└── doc/                            # Luồng QC, auto label, tiến độ
```

## Cài đặt và chạy

### Yêu cầu

- Python 3.11 trở lên
- Node.js 20 trở lên
- FFmpeg (`ffmpeg`, `ffprobe` trong `PATH`). Không có thì vẫn tải video lên được, nhưng không kiểm tra được file hỏng, không đọc được fps (trang Gán nhãn tạm dùng 25 fps), không chuyển được `.avi` sang MP4 và không chạy được auto label, đánh giá bằng model.

### Backend

```bash
# Ở thư mục gốc của project
python -m venv .venv
# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# macOS / Linux
source .venv/bin/activate

cd backend
pip install -r requirements.txt
cp .env.example .env          # tuỳ chọn, xem mục Cấu hình
python -m uvicorn app.main:app --reload --port 8000
```

Tài liệu API tự sinh: http://localhost:8000/docs

Auto label và chạy model khi đánh giá (tuỳ chọn, thêm khoảng vài trăm MB thư viện):

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu   # máy không có GPU NVIDIA
pip install -r requirements-autolabel.txt                                         # ultralytics, giấy phép AGPL-3.0
```

Lần đầu chạy, trọng số `yolo26s.pt` (khoảng 20 MB) hoặc `yolo26x.pt` (khoảng 119 MB) tự tải về `backend/storage/models/`. Chưa cài thì các nút này báo lỗi kèm lệnh cài, phần còn lại vẫn chạy bình thường.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Mở http://localhost:5173. Khi chạy dev, Vite chuyển tiếp mọi request `/api` sang `http://localhost:8000` nên không cần cấu hình CORS.

Build bản production: `npm run build` (kết quả ở `frontend/dist/`), xem thử bằng `npm run preview`.

### Chạy test

```bash
cd backend
pytest
```

Một số test cần `ffmpeg` và `ffprobe`; máy không có thì các test đó tự bỏ qua.

## Cấu hình

**Backend** (`backend/.env`). Sửa `.env` thì phải khởi động lại backend (`--reload` chỉ theo dõi file `.py`).

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PROJECT_NAME` | `LapUse QC` | Tên hiển thị trên trang docs API |
| `API_V1_PREFIX` | `/api/v1` | Tiền tố của mọi API |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | Các origin được phép gọi API |
| `UPLOAD_DIR` | `backend/storage/uploads` | Video, `index.json` (danh sách video) và `projects.json` |
| `ANNOTATION_DIR` | `backend/storage/annotations` | File nhãn, mỗi video một file |
| `GT_DIR` | `backend/storage/gt` | Các version GT (API cũ, xem mục GT) |
| `EVAL_DIR` | `backend/storage/evaluations` | Các lượt đánh giá model |
| `EVAL_MODEL_DIR` | `backend/storage/eval_models` | File model tải lên để đánh giá |
| `MODEL_DIR` | `backend/storage/models` | Trọng số model của auto label |
| `MAX_UPLOAD_SIZE_MB` | `5120` | Dung lượng tối đa mỗi video |
| `MAX_MODEL_SIZE_MB` | `1024` | Dung lượng tối đa file model |
| `MAX_PREDICTION_SIZE_MB` | `200` | Dung lượng tối đa file kết quả JSON |
| `AUTOLABEL_MODEL` | `yolo26s.pt` | Model auto label mặc định (hoặc `yolo26x.pt`) |
| `AUTOLABEL_SAMPLES_PER_SECOND` | `10` | Số frame mỗi giây video đưa vào model khi auto label |

Định dạng video được nhận: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`. Video trình duyệt không phát được (vỏ `.avi` / `.mkv`, hoặc codec khác H.264 / VP8 / VP9 / AV1, ví dụ MJPEG) được tự chuyển nền sang bản xem H.264 MP4 (`<id>.play.mp4`), giữ nguyên từng frame để nhãn khớp với file gốc. File gốc vẫn được giữ.

**Frontend** (`frontend/.env.local`):

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` | Địa chỉ gốc của API backend |

## API

Tất cả nằm dưới tiền tố `/api/v1`. Chi tiết body và response xem ở http://localhost:8000/docs.

**Video**

| Method | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/uploads` | Danh sách video, mới nhất trước |
| POST | `/uploads` | Tải video lên (multipart: `file`, tuỳ chọn `suggested_group`, `project_id`) |
| GET | `/uploads/{id}` | Thông tin một video (đọc bổ sung fps nếu còn thiếu) |
| GET | `/uploads/{id}/video` | Phát video (bản xem MP4 nếu có), hỗ trợ tua |
| POST | `/uploads/{id}/proxy` | Tạo lại bản xem MP4 khi lần chuyển trước bị lỗi |
| DELETE | `/uploads/{id}` | Xoá video, bản xem và nhãn đi kèm |
| POST | `/uploads/classify` | Chuyển một hoặc nhiều video sang nhóm (`upload_ids`, `group`; `null` là chưa phân loại) |

**Project**

| Method | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/projects` | Danh sách project, cũ nhất trước |
| POST | `/projects` | Tạo project (`name`, không trùng tên) |
| PATCH | `/projects/{id}` | Đổi tên |
| DELETE | `/projects/{id}` | Xoá project cùng mọi video bên trong (file gốc, bản xem, nhãn), không hoàn tác được |
| POST | `/uploads/project` | Chuyển video sang project khác (`upload_ids`, `project_id`; `null` để bỏ khỏi project) |

**Nhãn và auto label**

| Method | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/uploads/{id}/annotation` | Nhãn của video (chưa gán thì trả nhãn rỗng) |
| PUT | `/uploads/{id}/annotation` | Lưu (ghi đè) nhãn của video |
| GET | `/uploads/{id}/annotation/frames` | Box của từng frame sau khi nội suy |
| GET | `/annotations/summary` | Số người, trạng thái đã gán xong, số track auto chưa xác nhận của mọi video |
| GET | `/autolabel/models` | Các model chọn được cho auto label, model mặc định đứng đầu |
| POST | `/uploads/{id}/autolabel` | Chạy auto label nền (body tuỳ chọn `{"model": "yolo26x.pt"}`) |
| GET | `/uploads/{id}/autolabel` | Trạng thái, tiến độ auto label của video |

**GT** (không còn trang riêng, xem mục Ground truth)

| Method | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET | `/gt/preview/{upload_id}` | GT của một video dựng từ nhãn hiện tại (`frame_step`), dùng ở panel GT trang Gán nhãn |
| GET | `/gt/readiness` | Kiểm tra từng video đã phân loại có đủ điều kiện vào GT không |
| GET / POST | `/gt` | Danh sách / khoá version GT (`upload_ids`, `frame_step`, `note`) |
| GET | `/gt/{version}`, `/gt/{version}/download` | Nội dung / tải file JSON một version |

**Đánh giá model**

| Method | Đường dẫn | Mô tả |
| --- | --- | --- |
| GET / POST | `/eval-models` | Danh sách / tải file model lên (multipart: `file` .pt / .onnx, tuỳ chọn `name`), đọc danh sách lớp |
| DELETE | `/eval-models/{id}` | Xoá model |
| POST | `/evaluations/run` | Chạy model qua video của project rồi chấm, chạy nền (`project_id`, `model_id`, `classes`, `name`, `params`) |
| GET | `/evaluations/jobs`, `/evaluations/jobs/{id}` | Các lần chạy nền (`?project_id=`) / tiến độ một lần chạy, xong thì có `run_id` |
| POST | `/evaluations` | Chấm từ file kết quả JSON có sẵn (multipart: `file`, `project_id`, tuỳ chọn `name` và tham số chấm) |
| GET | `/evaluations` | Danh sách lượt đánh giá, mới nhất trước (`?project_id=`) |
| GET / DELETE | `/evaluations/{id}` | Kết quả đầy đủ / xoá một lượt |
| GET | `/evaluations/{id}/download` | Tải kết quả dạng JSON |
| PATCH | `/evaluations/{id}/videos/{upload_id}` | Phân loại lỗi của một video (`review`, `note`) |
| PATCH | `/evaluations/{id}/report` | Sửa nhận xét, duyệt / bỏ duyệt báo cáo (`summary_note`, `status`) |

## Dữ liệu

### Video và project

Mỗi video là một bản ghi trong `backend/storage/uploads/index.json`, gồm metadata đọc bằng ffprobe (thời lượng, fps, kích thước, codec), trạng thái bản xem MP4 và:

| Trường | Ý nghĩa |
| --- | --- |
| `project_id` | Project chứa video; `null` là chưa thuộc project nào (hiện ngoài các folder ở trang Tải dữ liệu) |
| `group` | `null` (Chưa phân loại), `using` (có người sử dụng laptop), `not_using` (không có) |
| `suggested_group` | Đoán từ tên thư mục lúc tải lên, ví dụ `khong_dung/` gợi ý `not_using`. Chỉ để tham khảo |
| `classified_at` | Thời điểm phân loại |

Danh sách project ở `backend/storage/uploads/projects.json`. Project chỉ là nhãn gắn trên video: video vẫn lưu chung một thư mục, không di chuyển file. Video chưa thuộc project nào thì chưa phân loại, gán nhãn hay đánh giá được.

Video chỉ chia hai nhóm, không có case con, không có trạng thái review. Hai nhóm khai báo ở [backend/app/schemas/upload.py](backend/app/schemas/upload.py) và [frontend/src/classification/constants.js](frontend/src/classification/constants.js), phải giữ hai nơi khớp nhau. Dữ liệu cũ có `subcase`, `review_status`, `return_note` thì các trường đó bị bỏ qua khi đọc.

### Nhãn

Mỗi video có một file `backend/storage/annotations/<upload_id>.json`. Chỉ gán một loại đối tượng: **người đang sử dụng laptop**.

```json
{
  "upload_id": "62644ecc7ca241949a4fd0c08457f8b0",
  "done": true,
  "updated_at": "2026-09-25T09:00:00Z",
  "tracks": [
    {
      "track_id": 1,
      "origin": "human",
      "confirmed": true,
      "segments": [{ "start": 120, "end": 480 }],
      "keyframes": {
        "120": { "x": 0.31, "y": 0.22, "w": 0.12, "h": 0.40 },
        "480": { "x": 0.35, "y": 0.24, "w": 0.12, "h": 0.38 }
      }
    }
  ],
  "auto_label": null
}
```

- **Track:** một người, gồm một hoặc nhiều **segment** (đoạn frame liên tục, tính cả hai đầu; `end: null` là kéo tới hết video, phải kết thúc trước khi đánh giá). Các segment không chồng nhau. Auto label tạo mỗi đoạn liên tục thành một track riêng.
- **Keyframe:** box tại một frame (số frame bắt đầu từ 0), toạ độ chuẩn hoá 0 đến 1. Box giữa hai keyframe trong cùng segment được nội suy tuyến tính; trước keyframe đầu và sau keyframe cuối thì chưa có box.
- **`origin` / `confirmed`:** track do người vẽ (`human`) hay auto label đề xuất (`auto`). Track auto mới tạo có `confirmed: false`, box có thêm `confidence`; người gán chấp nhận hoặc sửa thì thành `true`. `auto_label` ghi model và thời điểm chạy. Chi tiết ở [doc/auto-label.md](doc/auto-label.md).
- **`done`:** người gán đánh dấu đã gán xong video.
- File nhãn còn trường `case` cũ (không dùng nữa). File nhãn định dạng cũ (box theo từng frame) được tự chuyển sang track khi đọc.

## Ground truth (GT)

GT là nhãn của video được đổi sang dạng dùng để chấm model. App không còn trang Tạo GT: **khi chạy đánh giá, GT được dựng từ nhãn hiện tại** của các video đủ điều kiện trong project và chụp lại trong kết quả, nên sửa nhãn sau đó không làm đổi lượt đánh giá cũ. Panel **Ground truth** ở trang Gán nhãn cho xem trước phần GT của video đang gán. Các API khoá version GT (`/gt`) vẫn còn nhưng không có giao diện.

**Điều kiện video đủ để chấm** (kiểm tra trong `backend/app/services/gt_builder.py`):

| Mức | Điều kiện |
| --- | --- |
| Chặn (bị bỏ qua khi đánh giá) | Chưa phân loại; chưa có fps / thời lượng; video `using` chưa gán người nào, còn đoạn chưa kết thúc, hoặc còn track auto chưa xác nhận |
| Cảnh báo (vẫn chấm) | Người gán chưa đánh dấu đã xong; người chưa có box nào (cả đoạn bị bỏ qua khi chấm); video `not_using` vẫn còn nhãn người |

**Nội dung GT của một video:**

```json
{
  "upload_id": "62644ecc...", "name": "cctv.mp4", "fps": 25, "width": 1920, "height": 1080,
  "total_frames": 256, "group": "using",
  "events": [{ "track_id": 1, "start": 37, "end": 111 }],
  "frames": { "40": [{ "track_id": 1, "bbox": [0.31, 0.22, 0.12, 0.40], "source": "interpolated" }] },
  "ignore": [{ "track_id": 1, "start": 37, "end": 39, "reason": "Trước box đầu tiên" }]
}
```

- **Frame được chấm** là các frame chia hết cho `frame_step`. Frame được chấm không có box và không nằm trong `ignore` là negative. Mọi frame của video `not_using` đều là negative.
- **`frames`** chỉ gồm frame được chấm có box. `source` cho biết box vẽ ở keyframe hay nội suy.
- **`events`** là các đoạn thời gian người sử dụng laptop.
- **`ignore`** là khoảng có người nhưng chưa biết vị trí box (trước box đầu, sau box cuối, hoặc cả đoạn chưa có box). Model phát hiện trong khoảng này không bị tính đúng hay sai.

## Đánh giá model

**Cách chạy** (trang Đánh giá, nút "+ Chạy đánh giá"):

1. Tải file model lên: trọng số Ultralytics dạng `.pt` hoặc `.onnx`, YOLO hoặc RT-DETR (tên file có `rtdetr` / `rt-detr` thì nạp như RT-DETR). Máy chủ nạp thử để kiểm tra và đọc danh sách lớp. Model lưu ở `backend/storage/eval_models/`, dùng lại được.
2. Chọn các lớp được tính là "người đang sử dụng laptop". Model huấn luyện riêng thường chỉ có một lớp; model COCO thì chọn `person` (khi đó model bị tính thừa ở người không dùng laptop).
3. Bấm "Chạy model và đánh giá". Máy chủ đọc các frame được chấm của mọi video đủ điều kiện trong project, chạy model trên từng frame rồi chấm. Việc chạy nằm nền, trang hiện tiến độ; mỗi lúc chỉ một việc chạy model (dùng chung với auto label). Trên CPU, video 52 giây mất khoảng 2 phút với YOLO26s.

Nếu team model tự chạy model thì chấm từ **file kết quả JSON** có sẵn:

```json
{
  "model": "yolo-laptop-v3",
  "normalized": true,
  "videos": {
    "cam03_2026-09-24.mp4": {
      "5":  [{ "bbox": [0.31, 0.22, 0.12, 0.40], "score": 0.91 }],
      "10": [{ "bbox": [0.32, 0.22, 0.12, 0.40], "score": 0.88 }]
    }
  }
}
```

- Khoá trong `videos` là tên file video hoặc id video trong project. Tên trùng nhiều video thì phải dùng id. Khoá không khớp video nào được liệt kê trong kết quả.
- Số frame bắt đầu từ 0, cùng cách đếm với nhãn. Chỉ các frame chia hết cho `frame_step` được chấm.
- `bbox` là `[x, y, w, h]` theo tỉ lệ khung hình (0 đến 1). Toạ độ pixel thì đặt `"normalized": false`.
- Video không có trong file được coi là model không phát hiện gì.

**Cách chấm** (`backend/app/services/evaluator.py`):

- **Mức box**, tại mỗi frame được chấm: bỏ box có `score` dưới `score_threshold`, rồi ghép box có score cao nhất trước với box GT có IoU lớn nhất; IoU ≥ `iou_threshold` là đúng (TP). Box dự đoán không ghép được là thừa (FP), trừ khi frame nằm trong khoảng `ignore`. Box GT không được ghép là bỏ sót (FN). Mọi box trên video `not_using` đều là thừa.
- **Mức video**: model báo "có người sử dụng" khi có ít nhất `min_frames_video` frame được chấm có box.
- Mặc định: IoU 0.5, score 0.5, chấm mỗi 5 frame, 3 frame. Ngưỡng đạt đề xuất precision ≥ 0.90, recall ≥ 0.85 (khai báo ở `frontend/src/evaluation/constants.js`, cần chốt với team model).

Ở tab **Ca lỗi**, QC lead phân loại mỗi video có lỗi là *Lỗi nhãn*, *Lỗi model* hoặc *Không phải lỗi*, kèm ghi chú; bấm số frame để mở video tại frame đó. Tab **Báo cáo** tổng hợp lượt đó: chỉ số so với ngưỡng và lượt trước, xu hướng qua các lượt, ca lỗi, đề xuất tự sinh, nhận xét và nút duyệt; in hoặc lưu PDF bằng nút "In / lưu PDF".

## Phím tắt

**Phân loại nhanh** (trong project, nút "▶ Phân loại nhanh"):

| Phím | Tác dụng |
| --- | --- |
| `1` / `2` | Có / Không có người sử dụng, lưu và sang video kế tiếp |
| `S` | Bỏ qua video này |
| `Z` | Hoàn tác video vừa phân loại |
| `Space` | Phát / dừng |
| `←` / `→` | Tua lùi / tới 2 giây |
| `Esc` | Đóng |

**Gán nhãn:**

| Phím | Tác dụng |
| --- | --- |
| `Space` | Bắt đầu / kết thúc một sự kiện (một người mới dùng laptop) trong lúc video phát |
| `P` | Phát / dừng video |
| `Alt` | Nhảy về đầu sự kiện đang chọn, bấm lần nữa để xuống cuối |
| Kéo chuột | Vẽ box cho người đang chọn; kéo bên trong box để di chuyển, kéo góc để đổi kích thước |
| `I` / `O` | Bắt đầu / kết thúc đoạn của người đang chọn tại frame hiện tại |
| `K` | Ghim box nội suy tại frame này thành keyframe |
| `[` / `]` | Nhảy tới keyframe trước / sau |
| `←` / `→` | Lùi / tới 1 frame (giữ `Shift`: 10 frame) |
| `A` | Chấp nhận track auto label đang chọn |
| `Delete` | Xoá keyframe tại frame này (`Shift + Delete`: xoá cả người) |
| `Esc` | Huỷ sự kiện đang đánh dấu hoặc bỏ chọn người |
| `Enter` | Đánh dấu đã gán xong video, bấm lần nữa để chuyển về đang gán |
| `Ctrl + S` | Lưu ngay (bình thường tự lưu sau 0,8 giây) |

## Hạn chế hiện tại

- Lưu trữ bằng file JSON, chưa có database, chưa có đăng nhập / phân quyền.
- Video lưu trên đĩa của máy chủ, dự kiến chuyển sang object storage.
- Trạng thái job chạy nền (auto label, chạy model khi đánh giá) chỉ giữ trong bộ nhớ: khởi động lại backend giữa chừng thì phải bấm chạy lại.
- Chưa có cắt video dài thành đoạn ngắn, chưa phát hiện video trùng lúc tải lên.
- Trang Tổng quan chưa hiện chỉ số đánh giá model; đánh giá chưa tính theo tư thế (ngồi, cầm, mang) vì nhãn chưa có tư thế.
- Việc cần team chốt ghi ở [doc/tien-do.md](doc/tien-do.md) và [doc/luong-qc.md](doc/luong-qc.md).
