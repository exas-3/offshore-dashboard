'use client';
import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
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
      <div className="chart-tooltip-row">
        <span style={{ color: '#c084fc' }}>Active wallets</span>
        <span>{payload[0].value.toLocaleString()}</span>
      </div>
    </div>
  );
};

export default function ActiveWalletsChart({ dailyActiveWallets, hourlyActiveWallets }) {
  const [view, setView] = useState('daily');

  const data    = view === 'daily' ? dailyActiveWallets : hourlyActiveWallets;
  const isEmpty = !data?.length || data.every(d => d.activeWallets === 0);
  const peak    = data?.length ? Math.max(...data.map(d => d.activeWallets)) : 0;

  const tickInterval = view === 'hourly'
    ? Math.max(1, Math.floor((data?.length ?? 0) / 12))
    : 0;

  return (
    <div className="card chart-card" style={{ marginBottom: 16 }}>
      <div className="chart-header">
        <span className="card-title" style={{ margin: 0 }}>
          DAILY ACTIVE WALLETS — {view === 'daily' ? 'DAILY' : 'HOURLY'} FROM LAUNCH
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {peak > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
              peak {peak.toLocaleString()}
            </span>
          )}
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
      </div>

      {isEmpty ? (
        <div className="feed-empty" style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          No data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
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
              tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip isHourly={view === 'hourly'} />} />
            <Bar
              dataKey="activeWallets"
              name="Active wallets"
              fill="#c084fc"
              radius={[2, 2, 0, 0]}
              maxBarSize={view === 'daily' ? 60 : 14}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
