import { useState } from "react";
import { Link } from "react-router-dom";
import { reviewEvaluationVideo } from "../../api/client.js";
import { groupName } from "../../classification/constants.js";
import { REVIEW_OPTIONS } from "../../evaluation/constants.js";
import { fakeReview } from "../../evaluation/fakeRun.js";

function VideoRow({ video, onReview }) {
  const [note, setNote] = useState(video.note ?? "");
  const saveNote = () => {
    if ((video.note ?? "") !== note.trim()) onReview(video.review, note);
  };
  const expected = video.group === "using";
  return (
    <tr className={video.has_error ? "" : "row-ok"}>
      <td className="cell-video" title={video.name}>
        {video.name}
        {!video.in_prediction_file && <span className="tag-warn">không có trong file</span>}
      </td>
      <td>{groupName(video.group)}</td>
      <td className={video.predicted_using === expected ? "" : "cell-wrong"}>
        {video.predicted_using ? "Có người" : "Không có"}
        {video.predicted_using !== expected && " ✗"}
      </td>
      <td className="num">{video.box.tp}</td>
      <td className={video.box.fp ? "num cell-wrong" : "num"}>{video.box.fp}</td>
      <td className={video.box.fn ? "num cell-wrong" : "num"}>{video.box.fn}</td>
      <td className="cell-frames">
        {video.error_frames.slice(0, 6).map((f) => (
          <Link key={f} className="frame-chip" to={`/labeling?video=${video.upload_id}&frame=${f}`} title="Mở ở trang Gán nhãn">
            {f}
          </Link>
        ))}
        {video.error_frames.length > 6 && <span className="muted"> +{video.error_frames.length - 6}</span>}
        {video.error_frames.length === 0 && <span className="muted">—</span>}
      </td>
      <td>
        {video.has_error ? (
          <select
            className={`review-select review-${video.review}`}
            value={video.review}
            onChange={(e) => onReview(e.target.value, note)}
            aria-label={`Phân loại lỗi của ${video.name}`}
          >
            {REVIEW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted">Không có lỗi</span>
        )}
      </td>
      <td>
        {video.has_error && (
          <input
            className="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder="Ghi chú"
            maxLength={500}
          />
        )}
      </td>
    </tr>
  );
}

// Tab "Ca lỗi": QC lead phân loại từng video có lỗi là lỗi nhãn hay lỗi model, kèm ghi chú
export default function ErrorsTab({ run, onChanged, onError }) {
  const [onlyErrors, setOnlyErrors] = useState(true);
  const videos = onlyErrors ? run.videos.filter((v) => v.has_error) : run.videos;

  const review = async (uploadId, value, note) => {
    try {
      // Lượt giả lập không có trên máy chủ nên chỉ sửa trong trang
      onChanged(run.fake ? fakeReview(run, uploadId, value, note) : await reviewEvaluationVideo(run.id, uploadId, value, note));
    } catch (err) {
      onError(`Không lưu được phân loại lỗi: ${err.message}`);
    }
  };

  return (
    <div className="card">
      <div className="videos-head">
        <h3 className="eval-sub-title">
          Ca lỗi · {run.error_video_count}/{run.video_count} video
        </h3>
        <label className="only-errors">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
          Chỉ hiện video có lỗi
        </label>
      </div>
      {videos.length === 0 ? (
        <p className="muted">Không có video nào có lỗi.</p>
      ) : (
        <div className="upload-table-wrap">
          <table className="eval-table videos-table">
            <thead>
              <tr>
                <th>Video</th>
                <th>Thực tế</th>
                <th>Model báo</th>
                <th className="num">Đúng</th>
                <th className="num">Thừa</th>
                <th className="num">Bỏ sót</th>
                <th>Frame lỗi</th>
                <th>Phân loại lỗi</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((v) => (
                <VideoRow key={v.upload_id} video={v} onReview={(value, note) => review(v.upload_id, value, note)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="eval-help">
        Bấm số frame để mở video tại frame đó ở trang Gán nhãn. Lỗi do nhãn thì sửa nhãn rồi chạy lại; lỗi do model thì
        ghi vào báo cáo cho team model.
      </p>
    </div>
  );
}
