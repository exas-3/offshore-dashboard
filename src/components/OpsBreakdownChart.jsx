import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const COLORS = {
  extortion: '#c084fc',
  armsDeal:  '#4a9fd8',
  drugDeal:  '#3ecf6a',
  partial:   '#555f54',
};

const LABELS = {
  extortion: 'Extortion',
  armsDeal:  'Arms Deal',
  drugDeal:  'Drug Deal',
  partial:   'Partial',
};

function fmt(v) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v;
}

const CustomTooltip = ({ active, payload, label, mode }) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  const unit  = mode === 'dirty' ? ' $DIRTY' : ' ops';
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map(p => p.value > 0 && (
        <div key={p.dataKey} className="chart-tooltip-row">
          <span style={{ color: p.fill }}>{LABELS[p.dataKey.replace('Dirty', '')]}</span>
          <span>{p.value.toLocaleString()}{unit}</span>
        </div>
      ))}
      <div className="chart-tooltip-row" style={{ marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
        <span style={{ color: 'var(--text-2)' }}>Total</span>
        <span style={{ color: 'var(--text)' }}>{total.toLocaleString()}{unit}</span>
      </div>
    </div>
  );
};

const CustomLegend = ({ payload }) => (
  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 4 }}>
    {payload.map((p, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-2)' }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, background: p.color, borderRadius: 2 }} />
        {LABELS[p.dataKey.replace('Dirty', '')] ?? p.value}
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

export default function OpsBreakdownChart({ dailyOpBreakdown, hourlyOpBreakdown }) {
  const [view, setView]   = useState('daily');
  const [mode, setMode]   = useState('ops');
  const [range, setRange] = useState('all');

  const raw  = view === 'daily' ? dailyOpBreakdown : hourlyOpBreakdown;
  const data = sliceRange(raw, view, range);

  const keys = mode === 'ops'
    ? ['extortion', 'armsDeal', 'drugDeal', 'partial']
    : ['extortionDirty', 'armsDealDirty', 'drugDealDirty', 'partialDirty'];

  const isEmpty = !data?.length || data.every(d => keys.every(k => (d[k] ?? 0) === 0));

  const tickInterval = view === 'hourly'
    ? Math.max(1, Math.floor((data?.length ?? 0) / 12))
    : 0;

  const colorOf = key => COLORS[key.replace('Dirty', '')];

  return (
    <div className="card chart-card">
      <div className="chart-header">
        <span className="card-title" style={{ margin: 0 }}>
          OPS BREAKDOWN — {view === 'daily' ? 'DAILY' : 'HOURLY'} FROM LAUNCH
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="chart-toggle">
            <button className={`toggle-btn ${mode === 'ops'   ? 'toggle-btn--active' : ''}`} onClick={() => setMode('ops')}>Ops</button>
            <button className={`toggle-btn ${mode === 'dirty' ? 'toggle-btn--active' : ''}`} onClick={() => setMode('dirty')}>$DIRTY</button>
          </div>
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
        <div className="feed-empty" style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          No data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1a35" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false} tickLine={false} interval={tickInterval}
            />
            <YAxis
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false} tickLine={false}
              tickFormatter={fmt}
            />
            <Tooltip content={<CustomTooltip mode={mode} />} />
            <Legend content={<CustomLegend />} />
            {keys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                name={key}
                stackId="a"
                fill={colorOf(key)}
                maxBarSize={60}
                radius={i === keys.length - 1 ? [2, 2, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
