# Tiến độ – LapUse QC

Cập nhật 30/09/2026

Tài liệu này ghi lại những gì ứng dụng LapUse QC đã làm được, những gì còn chờ quyết định và các việc tiếp theo. Luồng QC đầy đủ xem ở [luong-qc.md](luong-qc.md), auto label ở [auto-label.md](auto-label.md). Cài đặt, API và định dạng dữ liệu xem ở [README](../README.md).

## Tóm tắt

| Bước trong luồng QC | Chỗ làm trong ứng dụng | Trạng thái |
| --- | --- | --- |
| 1. Tải dữ liệu | Tải dữ liệu `/upload` | Xong |
| 2. Phân loại video | Mở một project ở trang Tải dữ liệu `/upload` | Xong |
| 3. Gán box | Gán nhãn `/labeling` (có auto label) | Xong |
| 4. Tạo GT | Tự dựng từ nhãn mỗi khi chạy đánh giá; xem trước ở panel GT trang Gán nhãn | Xong (không còn trang riêng) |
| 5. Đánh giá model | Tab Kết quả, Ca lỗi ở trang Đánh giá `/evaluation` | Xong (chưa tính theo tư thế) |
| 6. Báo cáo | Tab Báo cáo ở trang Đánh giá `/evaluation` | Xong |
| 7. Tổng quan | Tổng quan `/overview` | Xong phần tiến độ dữ liệu, chưa có chỉ số model |

Backend có 94 test tự động, tất cả đều qua.

## Thay đổi về luồng QC

- **Dữ liệu chia theo project.** Mỗi project là một bộ video do người dùng tự gom. Phân loại, gán nhãn và đánh giá đều làm trong một project.
- **Phân loại trước, gán box sau.** Phân loại chỉ cần xem lướt nên nhanh hơn nhiều so với vẽ box.
- **Hai nhóm, không có case con:** *Có người sử dụng* (`using`) và *Không có người sử dụng* (`not_using`).
- **Video `not_using` không cần vẽ box.** Mọi frame của chúng là negative, nhờ vậy đo được tỷ lệ báo nhầm của model trên cảnh có laptop mà không ai dùng.
- **Chỉ gán một loại box:** người đang sử dụng laptop. Không gán box laptop, không gán người không dùng máy.
- **Không có review trong ứng dụng.** Việc người thứ hai review mẫu phân loại và box làm ngoài ứng dụng.
- **GT không còn khoá theo version bằng tay.** Mỗi lượt đánh giá tự dựng GT từ nhãn hiện tại và lưu lại cùng kết quả.

## Đã làm được

### 1. Tải dữ liệu và project

- Đầu trang có ba nút: **+ Tạo project**, **Tải video**, **Tải folder** (mọi video trong một thư mục, kể cả thư mục con). Kéo thả video hoặc thư mục vào trang cũng được; thả lên icon folder nào thì vào project đó.
- Project hiện thành lưới **icon folder**; bấm vào để vào trong, đổi tên hoặc xoá. Xoá project thì xoá luôn video, bản xem và nhãn bên trong. Video chưa thuộc project nào nằm ngoài, bên dưới lưới folder.
- Tải xong hiện hộp thoại **"Lưu N video vào đâu?"** để chọn hoặc tạo project. Tải folder thì tên thư mục được điền sẵn làm tên project mới. Video đang tải và video đang chờ chọn nơi lưu không hiện trong danh sách; tiến độ hiện trên nút đã bấm.
- Chỉ nhận `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, tối đa 5 GB mỗi file. ffprobe phát hiện file hỏng và đọc thời lượng, fps, kích thước, codec.
- Video trình duyệt không phát được (ví dụ `.avi` MJPEG từ camera) được tự chuyển nền sang MP4 H.264, giữ nguyên số frame.
- Tên thư mục gợi ý được nhóm (ví dụ `khong_dung/`) thì ghi lại làm gợi ý khi phân loại.

### 2. Phân loại video

- Nằm trong từng project. Cây folder: *Chưa phân loại* và hai nhóm. Lưới video có thumbnail, rê chuột lên thì phát không tiếng.
- Chọn nhiều video để kéo thả vào folder, chuyển tới nhóm khác, chuyển sang project khác hoặc xoá.
- **Phân loại nhanh:** xem lần lượt từng video ở khung lớn, tốc độ 1x đến 3x; bấm `1` / `2` là lưu và sang video kế tiếp. Có hoàn tác và bỏ qua.

### 3. Gán box

- Chọn project ở đầu trang; danh sách video chia theo nhóm, mỗi video có ô tiến độ: *chưa label*, *đang label*, *✨ chờ xác nhận* (còn đề xuất của auto label), *đã label*, *không cần label*. Lọc được theo đã / chưa hoàn thành.
- Mỗi người là một *track*, có thể có nhiều đoạn. Bấm `Space` lúc video đang phát để đánh dấu đầu và cuối đoạn, vẽ box ở keyframe, các frame giữa tự nội suy. Tự lưu sau 0,8 giây, đủ phím tắt.
- Người gán bấm **Đánh dấu đã xong** (`Enter`) khi gán hết mọi người trong video.
- **Auto label:** chọn model (YOLO26s hoặc YOLO26x) rồi bấm ✨ Auto label; model đề xuất người đang dùng laptop, mỗi đoạn liên tục một track, người gán chấp nhận (`A`), sửa hoặc xoá. Chi tiết ở [auto-label.md](auto-label.md).
- **Panel Ground truth** hiện phần GT của video đang gán theo đúng định dạng dùng khi chấm; bấm số frame để tua tới.
- Mở được video tại một frame cụ thể qua link `?video=…&frame=…` (dùng từ danh sách ca lỗi khi đánh giá).

### 4. GT

- Không còn trang Tạo GT. Khi chạy đánh giá, GT được dựng từ nhãn hiện tại của các video đủ điều kiện và chụp lại trong kết quả, nên sửa nhãn sau đó không làm đổi lượt cũ.
- Video bị bỏ qua khi: chưa phân loại, thiếu fps, video có người dùng nhưng chưa gán ai, còn đoạn chưa kết thúc, hoặc còn track auto chưa xác nhận. Lý do được liệt kê trong kết quả đánh giá.
- GT gồm `frames` (box ở các frame được chấm, mặc định mỗi 5 frame), `events` (đoạn thời gian người dùng laptop) và `ignore` (khoảng có người nhưng chưa biết vị trí box, không chấm).

### 5–6. Đánh giá model và báo cáo

- Trang **Đánh giá** gộp đánh giá và báo cáo. Nút **+ Chạy đánh giá**: tải model (.pt / .onnx, YOLO hoặc RT-DETR), chọn lớp, máy chủ chạy model qua các frame được chấm của video trong project rồi chấm. Hoặc chấm từ file kết quả JSON do team model gửi.
- Mỗi lượt có 3 tab:
  - **Kết quả:** precision, recall, F1 mức box so với ngưỡng; bảng đúng / sai mức video; mức box theo nhóm; video bị bỏ qua.
  - **Ca lỗi:** QC lead phân loại từng video là lỗi nhãn, lỗi model hay không phải lỗi, kèm ghi chú; bấm số frame để mở ở trang Gán nhãn.
  - **Báo cáo:** so với lượt trước, biểu đồ xu hướng precision / recall / F1 qua các lượt, đề xuất tự sinh, nhận xét, nút duyệt, in / lưu PDF.

### 7. Tổng quan

- Xem theo tất cả hoặc một project: số video, % đã phân loại, % đã gán nhãn, số video chờ xác nhận auto label; tiến độ Phân loại → Gán nhãn; bảng theo project; danh sách việc cần xử lý kèm nút dẫn tới chỗ sửa.

### Khác

- Logo mới (khung phát hiện quanh laptop có dấu tích) trên sidebar và làm favicon.

## Cần team quyết định

- [ ] Ngưỡng precision, recall và IoU dùng khi đánh giá (đang tạm: precision ≥ 0.90, recall ≥ 0.85, IoU 0.5).
- [ ] Danh sách tư thế gắn cho từng đoạn (ngồi, cầm, mang), để tính chỉ số theo tư thế.
- [ ] Model auto label mặc định: YOLO26s (nhanh, ít đề xuất nhầm), hay YOLO26x (thấy laptop nhiều hơn, chậm gấp khoảng 5 lần). RT-DETR-L đã bỏ khỏi danh sách vì hay nhận nhầm laptop.
- [ ] Giấy phép `ultralytics` (AGPL-3.0) cho phạm vi sử dụng thực tế.
- [x] Case con trong mỗi nhóm: đã chốt không dùng.
- [x] Review trong ứng dụng: đã bỏ, review mẫu làm ngoài ứng dụng.

## Vấn đề đã biết

- **Video trùng:** chưa tự phát hiện video đã tải lên trước đó. Nếu một video vừa nằm ngoài vừa nằm trong project, hoặc ở hai project, thì có thể bị gán nhãn và chấm hai lần.
- **Trường `case` cũ** vẫn còn trong file nhãn và ô chọn case ở panel bên phải trang Gán nhãn (đang ẩn). Không còn dùng, nên bỏ.
- **Job chạy nền chỉ giữ trong bộ nhớ:** khởi động lại backend trong lúc auto label hoặc chạy model thì phải bấm lại.
- **Chưa có database và phân quyền.** Dữ liệu lưu bằng file JSON trong `backend/storage/`, mọi người dùng đều làm được mọi thao tác.

## Việc tiếp theo

1. **Cắt video dài thành đoạn ngắn để phân loại.** Đã có thiết kế: tải video dài vào một khu riêng (không thuộc project nào), chọn độ dài mỗi đoạn và project nhận, cắt nền bằng ffmpeg (`-c copy` với H.264, encode lại với `.avi`), xoá video dài sau khi cắt xong.
2. **Phát hiện video trùng** lúc tải lên (cùng tên và dung lượng, hoặc cùng mã băm).
3. **Tổng quan:** hiện chỉ số đánh giá mới nhất của từng project.
4. **Tư thế cho từng đoạn** khi gán box, rồi tính chỉ số theo tư thế.
5. **Auto label hàng loạt**; đo độ chính xác của auto label trên video gán tay độc lập.
