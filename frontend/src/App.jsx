import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import MainLayout from "./layouts/MainLayout.jsx";
import OverviewPage from "./pages/OverviewPage.jsx";
import UploadPage from "./pages/UploadPage.jsx";
import LabelingPage from "./pages/LabelingPage.jsx";
import EvaluationPage from "./pages/EvaluationPage.jsx";

// Trang Báo cáo cũ đã gộp vào trang Đánh giá: /reports?run=x chuyển sang tab Báo cáo của lượt đó
function ReportsRedirect() {
  const params = new URLSearchParams(useLocation().search);
  params.set("tab", "report");
  return <Navigate to={`/evaluation?${params}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/upload" element={<UploadPage />} />
        {/* Phân loại nay nằm trong từng project ở trang Tải dữ liệu */}
        <Route path="/classify" element={<Navigate to="/upload" replace />} />
        <Route path="/labeling" element={<LabelingPage />} />
        <Route path="/evaluation" element={<EvaluationPage />} />
        <Route path="/reports" element={<ReportsRedirect />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  );
}
