'use client';
export default function StatCard({ label, value, sub, accent = 'gold', loading }) {
  return (
    <div className={`stat-card stat-card--${accent}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${loading ? 'stat-value--loading' : ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
