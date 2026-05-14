'use client';
import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

function fmt(v) {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return v.toFixed(0);
}

function fmtTs(ts, hourly) {
  const d = new Date(ts * 1000);
  return hourly
    ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`
    : `${d.getMonth() + 1}/${d.getDate()}`;
}

const CustomTooltip = ({ active, payload, label, isHourly }) => {
  if (!active || !payload?.length) return null;
  const byKey = Object.fromEntries(payload.map(p => [p.dataKey, p.value ?? 0]));
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{fmtTs(label, isHourly)}</div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#4a9fd8' }}>Purchased</span>
        <span>{(byKey.purchased ?? 0).toLocaleString()}</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#e05252' }}>Consumed</span>
        <span>{(byKey.burned ?? 0).toLocaleString()}</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#3ecf6a' }}>Refunded</span>
        <span>{(byKey.minted ?? 0).toLocaleString()}</span>
      </div>
    </div>
  );
};

const CustomLegend = ({ payload }) => (
  <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 4 }}>
    {payload.map((p, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-2)' }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, background: p.color, borderRadius: 2 }} />
        {p.value}
      </div>
    ))}
  </div>
);

const RANGES = [
  { key: '24h',  label: '24h' },
  { key: '72h',  label: '72h' },
  { key: 'all',  label: 'All' },
];

export default function InfluenceChart({ dailyInfluence, hourlyInfluence, influenceStats }) {
  const [range, setRange] = useState('all');

  const data = range === 'all'
    ? (dailyInfluence ?? [])
    : range === '72h'
      ? (hourlyInfluence ?? []).slice(-72)
      : (hourlyInfluence ?? []).slice(-24);

  const isEmpty = !data?.length || data.every(d => d.minted === 0 && d.burned === 0);

  const tickInterval = range !== 'all'
    ? Math.max(1, Math.floor((data?.length ?? 0) / 12))
    : 0;

  const rangeLabel = range === 'all' ? 'ALL TIME (DAILY)' : range.toUpperCase() + ' (HOURLY)';

  return (
    <div className="card chart-card">
      <div className="chart-header">
        <span className="card-title" style={{ margin: 0 }}>
          INFLUENCE FLOW — {rangeLabel}
        </span>
        <div className="chart-toggle">
          {RANGES.map(r => (
            <button
              key={r.key}
              className={`toggle-btn ${range === r.key ? 'toggle-btn--active' : ''}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {influenceStats && (
        <div className="influence-stats">
          <span className="influence-stat">
            <span className="influence-stat-label">PURCHASED</span>
            <span className="influence-stat-value" style={{ color: 'var(--blue, #4a9fd8)' }}>
              {influenceStats.totalPurchased != null ? influenceStats.totalPurchased.toLocaleString() : '—'}
            </span>
          </span>
          <span className="influence-stat">
            <span className="influence-stat-label">CONSUMED</span>
            <span className="influence-stat-value" style={{ color: 'var(--red)' }}>
              {influenceStats.totalBurned.toLocaleString()}
            </span>
          </span>
          <span className="influence-stat">
            <span className="influence-stat-label">REFUNDED</span>
            <span className="influence-stat-value" style={{ color: 'var(--green)' }}>
              {influenceStats.totalRefunded?.toLocaleString() ?? influenceStats.totalMinted.toLocaleString()}
            </span>
          </span>
          <span className="influence-stat">
            <span className="influence-stat-label">CIRCULATING</span>
            <span className="influence-stat-value" style={{ color: 'var(--gold)' }}>
              {influenceStats.circulating != null
                ? influenceStats.circulating.toLocaleString(undefined, { maximumFractionDigits: 0 })
                : '—'}
            </span>
          </span>
        </div>
      )}

      {isEmpty ? (
        <div className="feed-empty" style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Syncing influence history…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1a35" vertical={false} />
            <XAxis
              dataKey="ts"
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              interval={tickInterval}
              tickFormatter={ts => fmtTs(ts, range !== 'all')}
            />
            <YAxis
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={fmt}
            />
            <Tooltip content={<CustomTooltip isHourly={range !== 'all'} />} />
            <Legend content={<CustomLegend />} />
            <Bar dataKey="purchased" name="Purchased" fill="#4a9fd8" maxBarSize={40} />
            <Bar dataKey="burned"    name="Consumed"  fill="#e05252" maxBarSize={40} />
            <Bar dataKey="minted"    name="Refunded"  fill="#3ecf6a" maxBarSize={40} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
