'use client';
import { useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';

function fmtTs(ts, hourly) {
  const d = new Date(ts * 1000);
  return hourly
    ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`
    : `${d.getMonth() + 1}/${d.getDate()}`;
}

const CustomTooltip = ({ active, payload, label, isHourly }) => {
  if (!active || !payload?.length) return null;
  const byKey = Object.fromEntries(payload.map(p => [p.dataKey, p.value]));
  const net = byKey.net ?? 0;
  const proto = byKey.protocolMint ?? 0;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{fmtTs(label, isHourly)}</div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#c084fc' }}>Minted</span>
        <span>{(byKey.minted ?? 0).toLocaleString()}</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#e05252' }}>Spent</span>
        <span>{(byKey.spent ?? 0).toLocaleString()}</span>
      </div>
      {proto > 0 && (
        <div className="chart-tooltip-row">
          <span style={{ color: '#d946ef' }}>Protocol Mint</span>
          <span>{proto.toLocaleString()}</span>
        </div>
      )}
      <div className="chart-tooltip-row" style={{ marginTop: 4, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
        <span style={{ color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>Net (players)</span>
        <span style={{ color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>
          {net >= 0 ? '+' : ''}{net.toLocaleString()}
        </span>
      </div>
    </div>
  );
};

const CustomLegend = ({ payload }) => (
  <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 4 }}>
    {payload.map((p, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-2)' }}>
        <span style={{
          display: 'inline-block', width: 10, height: p.type === 'line' ? 2 : 10,
          background: p.color, borderRadius: p.type === 'line' ? 0 : 2,
        }} />
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

export default function FlowChart({ dailyFlowBuckets, hourlyFlowBuckets }) {
  const [view, setView]   = useState('daily');
  const [range, setRange] = useState('all');

  const raw  = view === 'daily' ? dailyFlowBuckets : hourlyFlowBuckets;
  // Hide protocol mint on the very first bucket (initial token distribution on launch day)
  const rawStripped = raw?.length
    ? [{ ...raw[0], protocolMint: 0 }, ...raw.slice(1)]
    : raw;
  const data    = sliceRange(rawStripped, view, range);
  const isEmpty = !data?.length || data.every(d => d.minted === 0 && d.spent === 0);

  const hasProtocol = data?.some(d => (d.protocolMint ?? 0) > 0);

  const tickInterval = view === 'hourly'
    ? Math.max(1, Math.floor((data?.length ?? 0) / 12))
    : 0;

  return (
    <div className="card chart-card">
      <div className="chart-header">
        <span className="card-title" style={{ margin: 0 }}>
          EMISSIONS VS BURN — {view === 'daily' ? 'DAILY' : 'HOURLY'}
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
        <div className="feed-empty" style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          No data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }} barCategoryGap="20%">
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
              yAxisId="vol"
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <YAxis
              yAxisId="net"
              orientation="right"
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v >= -1000 ? v : `${(v / 1000).toFixed(0)}k`}
            />
            <ReferenceLine yAxisId="net" y={0} stroke="#2a2448" strokeDasharray="4 4" />
            <Tooltip content={<CustomTooltip isHourly={view === 'hourly'} />} />
            <Legend content={<CustomLegend />} />
            <Bar yAxisId="vol" dataKey="minted"       name="Minted"        fill="#c084fc" maxBarSize={40} radius={[2, 2, 0, 0]} />
            <Bar yAxisId="vol" dataKey="spent"        name="Spent"         fill="#e05252" maxBarSize={40} radius={[2, 2, 0, 0]} />
            {hasProtocol && (
              <Bar yAxisId="vol" dataKey="protocolMint" name="Protocol Mint" fill="#d946ef" maxBarSize={40} radius={[2, 2, 0, 0]} />
            )}
            <Line
              yAxisId="net"
              type="monotone"
              dataKey="net"
              name="Net (players)"
              stroke="#4a9fd8"
              strokeWidth={2}
              dot={view === 'daily' ? { fill: '#4a9fd8', r: 3 } : false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
