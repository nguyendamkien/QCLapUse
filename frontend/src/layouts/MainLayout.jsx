import { Outlet } from "react-router-dom";
import Sidebar from "../components/Sidebar.jsx";

export default function MainLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
