'use client';
import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const COLORS = {
  burned:     '#e05252',
  assets:     '#c8a951',
  levels:     '#4a9fd8',
  enterprise: '#9b59d8',
};

const LABELS = {
  burned:     'Protocol Burn',
  assets:     'Asset Purchase',
  levels:     'Level Up',
  enterprise: 'Third Enterprise',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map(p => p.value > 0 && (
        <div key={p.dataKey} className="chart-tooltip-row">
          <span style={{ color: p.fill }}>{LABELS[p.dataKey]}</span>
          <span>{p.value.toLocaleString()}</span>
        </div>
      ))}
      <div className="chart-tooltip-row" style={{ marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
        <span style={{ color: 'var(--text-2)' }}>Total</span>
        <span style={{ color: 'var(--text)' }}>{total.toLocaleString()}</span>
      </div>
    </div>
  );
};

const CustomLegend = ({ payload }) => (
  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 4 }}>
    {payload.map((p, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-2)' }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, background: p.color, borderRadius: 2 }} />
        {LABELS[p.dataKey] ?? p.value}
      </div>
    ))}
  </div>
);

function sliceRange(data, view, range) {
  if (!data?.length || range === 'all') return data ?? [];
  const days = range === '1d' ? 1 : range === '3d' ? 3 : 7;
  const n = view === 'hourly' ? days * 24 : days;
  return data.slice(-n);
}

export default function BurnChart({ dailyBurnBuckets, hourlyBurnBuckets }) {
  const [view, setView]   = useState('daily');
  const [range, setRange] = useState('all');

  const raw     = view === 'daily' ? dailyBurnBuckets : hourlyBurnBuckets;
  const data    = sliceRange(raw, view, range);
  const isEmpty = !data?.length || data.every(d =>
    d.burned === 0 && d.assets === 0 && d.levels === 0 && (d.enterprise ?? 0) === 0
  );

  const tickInterval = view === 'hourly'
    ? Math.max(1, Math.floor((data?.length ?? 0) / 12))
    : 0;

  return (
    <div className="card chart-card">
      <div className="chart-header">
        <span className="card-title" style={{ margin: 0 }}>
          $DIRTY BURNED — {view === 'daily' ? 'DAILY' : 'HOURLY'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="chart-toggle">
            {['all', '7d', '3d', '1d'].map(r => (
              <button key={r} className={`toggle-btn ${range === r ? 'toggle-btn--active' : ''}`} onClick={() => setRange(r)}>
                {r === 'all' ? 'All' : r.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="chart-toggle">
            <button className={`toggle-btn ${view === 'daily'  ? 'toggle-btn--active' : ''}`} onClick={() => setView('daily')}>Daily</button>
            <button className={`toggle-btn ${view === 'hourly' ? 'toggle-btn--active' : ''}`} onClick={() => setView('hourly')}>Hourly</button>
          </div>
        </div>
      </div>

      {isEmpty ? (
        <div className="feed-empty" style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          No burn data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a241a" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#4a5448', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              interval={tickInterval}
            />
            <YAxis
              tick={{ fill: '#4a5448', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend content={<CustomLegend />} />
            <Bar dataKey="burned"     name="burned"     stackId="a" fill={COLORS.burned}     maxBarSize={60} />
            <Bar dataKey="assets"     name="assets"     stackId="a" fill={COLORS.assets}     maxBarSize={60} />
            <Bar dataKey="levels"     name="levels"     stackId="a" fill={COLORS.levels}     maxBarSize={60} />
            <Bar dataKey="enterprise" name="enterprise" stackId="a" fill={COLORS.enterprise} maxBarSize={60} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
