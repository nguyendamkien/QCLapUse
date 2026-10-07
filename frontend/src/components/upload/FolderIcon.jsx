// Icon folder của project, dùng ở lưới folder và hộp thoại chọn nơi lưu video
export default function FolderIcon({ open = false, size = 20 }) {
  return (
    <svg className="folder-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {open ? (
        <>
          <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7.5a2 2 0 0 0-1.9 1.4L3 18z" fill="#f59e0b" />
          <path d="M5.6 10.4A2 2 0 0 1 7.5 9H22l-2.6 8.6a2 2 0 0 1-1.9 1.4H3z" fill="#fbbf24" />
        </>
      ) : (
        <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#fbbf24" />
      )}
    </svg>
  );
}
