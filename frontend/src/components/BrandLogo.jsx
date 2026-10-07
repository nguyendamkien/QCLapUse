// Logo LapUse QC: khung phát hiện (4 góc vàng) quanh một laptop có dấu tích "đạt".
// Giữ khớp với public/favicon.svg.
export function BrandMark({ size = 40 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="brand-mark-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="0.55" stopColor="#0f766e" />
          <stop offset="1" stopColor="#134e4a" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="12" fill="url(#brand-mark-bg)" />
      <path
        d="M8.5 16.5V11.5a3 3 0 0 1 3-3h5M31.5 8.5h5a3 3 0 0 1 3 3v5M39.5 31.5v5a3 3 0 0 1-3 3h-5M16.5 39.5h-5a3 3 0 0 1-3-3v-5"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="15" y="14.5" width="18" height="12.5" rx="2.2" fill="none" stroke="#ffffff" strokeWidth="2.6" />
      <path d="M13 31h22" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" />
      <path
        className="brand-check"
        d="M19.6 20.9l2.9 2.9 5.4-5.6"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function BrandLogo() {
  return (
    <div className="brand" aria-label="LapUse QC">
      <BrandMark />
      <div className="brand-text">
        <span className="brand-name">
          LapUse <span className="brand-qc">QC</span>
        </span>
        <span className="brand-tagline">QC dữ liệu &amp; model</span>
      </div>
    </div>
  );
}
