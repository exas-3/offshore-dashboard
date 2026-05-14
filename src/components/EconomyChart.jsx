'use client';
import { useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

function fmtUsd(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtTs(ts, unit) {
  const d = new Date(ts * 1000);
  if (unit === 86400) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`;
}

const CustomTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{fmtTs(label, unit)}{d.live ? ' · live' : ''}</div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#3ecf6a' }}>INF Purchased</span>
        <span>{fmtUsd(d.inf_usdm)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#f59e0b' }}>DIRTY Minted</span>
        <span>{fmtUsd(d.dirty_minted_usdm)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#5a4575' }}>DIRTY Burned/Spent</span>
        <span>{fmtUsd(d.dirty_burned_usdm)}</span>
      </div>
      <div className="chart-tooltip-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 4, marginTop: 4 }}>
        <span style={{ color: d.dirty_net_usdm >= 0 ? '#e05252' : '#3ecf6a' }}>DIRTY Net</span>
        <span style={{ color: d.dirty_net_usdm >= 0 ? '#e05252' : '#3ecf6a' }}>
          {d.dirty_net_usdm >= 0 ? '+' : ''}{fmtUsd(d.dirty_net_usdm)}
        </span>
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 4 }}>
        @ ${d.price_dirty_usdm?.toFixed(4)} / $DIRTY
      </div>
    </div>
  );
};

export default function EconomyChart({ hourly, daily, loading }) {
  const [unit, setUnit] = useState(3600);
  const data = unit === 3600 ? hourly : daily;
  const hasData = Array.isArray(data) && data.length > 0;

  if (loading && !hasData) {
    return (
      <div className="card chart-card">
        <div className="chart-header">
          <span className="card-title" style={{ margin: 0 }}>VALUE ADDED VS EXTRACTED (USD)</span>
        </div>
        <div className="feed-empty" style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>
      </div>
    );
  }
  if (!hasData) return null;

  const tickInterval = unit === 3600 ? Math.max(1, Math.floor(data.length / 12)) : 0;
  const yMax = Math.max(...data.map(d => Math.max(d.inf_usdm, d.dirty_minted_usdm))) * 1.08;

  // Running totals for header
  const totalInfUsd   = data.reduce((s, d) => s + d.inf_usdm, 0);
  const totalNetUsd   = data.reduce((s, d) => s + d.dirty_net_usdm, 0);
  const netColor = totalNetUsd >= 0 ? '#e05252' : '#3ecf6a';

  return (
    <div className="card chart-card">
      <div className="chart-header">
        <span className="card-title" style={{ margin: 0 }}>VALUE ADDED VS EXTRACTED (USD)</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 10, fontFamily: 'JetBrains Mono' }}>
          <span title="Total INF purchased — real USD into the game">
            <span style={{ color: 'var(--text-2)' }}>IN </span>
            <span style={{ color: '#3ecf6a' }}>{fmtUsd(totalInfUsd)}</span>
          </span>
          <span title="Net DIRTY (minted − burned) at market price">
            <span style={{ color: 'var(--text-2)' }}>OUT </span>
            <span style={{ color: netColor }}>{fmtUsd(totalNetUsd)}</span>
          </span>
          <div className="chart-toggle">
            <button className={`toggle-btn ${unit === 3600  ? 'toggle-btn--active' : ''}`} onClick={() => setUnit(3600)}  style={{ fontSize: 10 }}>1H</button>
            <button className={`toggle-btn ${unit === 86400 ? 'toggle-btn--active' : ''}`} onClick={() => setUnit(86400)} style={{ fontSize: 10 }}>1D</button>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
          <defs>
            <linearGradient id="infGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#3ecf6a" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#3ecf6a" stopOpacity={0}    />
            </linearGradient>
            <linearGradient id="mintGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1a35" vertical={false} />
          <XAxis
            dataKey="ts"
            tick={{ fill: '#5a4575', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            axisLine={false} tickLine={false}
            interval={tickInterval}
            tickFormatter={ts => fmtTs(ts, unit)}
          />
          <YAxis
            tick={{ fill: '#5a4575', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            axisLine={false} tickLine={false}
            tickFormatter={fmtUsd}
            domain={[0, yMax || 'auto']}
            width={58}
          />
          <Tooltip content={<CustomTooltip unit={unit} />} />
          {/* INF Purchased — value flowing into the game */}
          <Area
            type="monotone"
            dataKey="inf_usdm"
            name="INF Purchased"
            stroke="#3ecf6a"
            strokeWidth={2}
            fill="url(#infGrad)"
            dot={false}
            activeDot={{ r: 3, fill: '#3ecf6a' }}
          />
          {/* DIRTY Minted — gross value extracted */}
          <Area
            type="monotone"
            dataKey="dirty_minted_usdm"
            name="DIRTY Minted"
            stroke="#f59e0b"
            strokeWidth={1.5}
            fill="url(#mintGrad)"
            dot={false}
            activeDot={{ r: 3, fill: '#f59e0b' }}
          />
          {/* DIRTY Burned/Spent — value recycled back */}
          <Line
            type="monotone"
            dataKey="dirty_burned_usdm"
            name="DIRTY Burned"
            stroke="#5a4575"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            activeDot={{ r: 3, fill: '#5a4575' }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* legend */}
      <div style={{ display: 'flex', gap: 16, paddingTop: 6, fontSize: 10, fontFamily: 'JetBrains Mono', color: 'var(--text-2)', justifyContent: 'center' }}>
        <span><span style={{ color: '#3ecf6a' }}>●</span> INF Purchased</span>
        <span><span style={{ color: '#f59e0b' }}>●</span> DIRTY Minted</span>
        <span><span style={{ color: '#5a4575' }}>╌</span> DIRTY Burned/Spent</span>
      </div>
    </div>
  );
}
