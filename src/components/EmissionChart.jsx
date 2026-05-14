'use client';
import { useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

function fmtTs(ts, hourly) {
  const d = new Date(ts * 1000);
  return hourly
    ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`
    : `${d.getMonth() + 1}/${d.getDate()}`;
}

const CustomTooltip = ({ active, payload, label, isHourly }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{fmtTs(label, isHourly)}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="chart-tooltip-row">
          <span style={{ color: p.color ?? p.fill }}>{p.name}</span>
          <span>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
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

function sliceRange(data, view, range) {
  if (!data?.length || range === 'all') return data ?? [];
  const days = range === '1d' ? 1 : range === '3d' ? 3 : 7;
  const n = view === 'hourly' ? days * 24 : days;
  return data.slice(-n);
}

export default function EmissionChart({ dailyBuckets, hourlyBuckets }) {
  const [view, setView]   = useState('daily');
  const [range, setRange] = useState('all');

  const raw     = view === 'daily' ? dailyBuckets : hourlyBuckets;
  const data    = sliceRange(raw, view, range);
  const isEmpty = !data?.length || data.every(d => d.mints === 0);

  const tickInterval = view === 'hourly'
    ? Math.max(1, Math.floor((data?.length ?? 0) / 12))
    : 0;

  return (
    <div className="card chart-card">
      <div className="chart-header">
        <span className="card-title" style={{ margin: 0 }}>
          $DIRTY EMISSIONS — {view === 'daily' ? 'DAILY' : 'HOURLY'}
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
          No emission data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1a35" vertical={false} />
            <XAxis
              dataKey="ts"
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              interval={tickInterval}
              tickFormatter={ts => fmtTs(ts, view === 'hourly')}
            />
            <YAxis
              yAxisId="ops"
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <YAxis
              yAxisId="dirty"
              orientation="right"
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <Tooltip content={<CustomTooltip isHourly={view === 'hourly'} />} />
            <Legend content={<CustomLegend />} />
            <Bar
              yAxisId="ops"
              dataKey="mints"
              name="Ops"
              fill="#c084fc"
              radius={[2, 2, 0, 0]}
              maxBarSize={view === 'daily' ? 60 : 12}
            />
            <Line
              yAxisId="dirty"
              type="monotone"
              dataKey="dirty"
              name="$DIRTY"
              stroke="#3ecf6a"
              strokeWidth={2}
              dot={view === 'daily' ? { fill: '#3ecf6a', r: 3 } : false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
