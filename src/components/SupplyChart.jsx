'use client';
import { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

function fmt(v) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}k`;
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
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{fmtTs(label, isHourly)}</div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#c084fc' }}>Supply</span>
        <span>{fmt(payload[0].value)} $DIRTY</span>
      </div>
    </div>
  );
};

export default function SupplyChart({ dailySupply, hourlySupply }) {
  const [view, setView] = useState('daily');

  const data    = view === 'daily' ? dailySupply : hourlySupply;
  const isEmpty = !data?.length;

  const tickInterval = view === 'hourly'
    ? Math.max(1, Math.floor((data?.length ?? 0) / 12))
    : 0;

  const min = data?.length ? Math.min(...data.map(d => d.supply)) * 0.98 : 0;
  const max = data?.length ? Math.max(...data.map(d => d.supply)) * 1.01 : undefined;

  return (
    <div className="card chart-card">
      <div className="chart-header">
        <span className="card-title" style={{ margin: 0 }}>
          $DIRTY SUPPLY OVER TIME — {view === 'daily' ? 'DAILY' : 'HOURLY'}
        </span>
        <div className="chart-toggle">
          <button
            className={`toggle-btn ${view === 'daily' ? 'toggle-btn--active' : ''}`}
            onClick={() => setView('daily')}
          >
            Daily
          </button>
          <button
            className={`toggle-btn ${view === 'hourly' ? 'toggle-btn--active' : ''}`}
            onClick={() => setView('hourly')}
          >
            Hourly
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className="feed-empty" style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Backfilling supply history…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="supplyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#c084fc" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#c084fc" stopOpacity={0} />
              </linearGradient>
            </defs>
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
              domain={[min, max]}
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={fmt}
            />
            <Tooltip content={<CustomTooltip isHourly={view === 'hourly'} />} />
            <Area
              type="monotone"
              dataKey="supply"
              stroke="#c084fc"
              strokeWidth={2}
              fill="url(#supplyGrad)"
              dot={view === 'daily' ? { fill: '#c084fc', r: 3 } : false}
              activeDot={{ r: 4, fill: '#c084fc' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
