'use client';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

function fmtMcap(v) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtTs(ts) {
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`;
}

function fmtSupply(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{fmtTs(label)}</div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#f59e0b' }}>Market Cap</span>
        <span>{fmtMcap(d.marketCap)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#5a4575' }}>Price</span>
        <span>{d.price?.toFixed(4)} USDm</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: '#5a4575' }}>Supply</span>
        <span>{fmtSupply(d.supply)} $DIRTY</span>
      </div>
    </div>
  );
};

export default function MarketCapChart({ data, loading }) {
  if (loading && !data?.length) {
    return (
      <div className="card chart-card">
        <div className="chart-header">
          <span className="card-title" style={{ margin: 0 }}>$DIRTY MARKET CAP — HOURLY</span>
        </div>
        <div className="feed-empty" style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!data?.length) return null;

  const tickInterval = Math.max(1, Math.floor(data.length / 12));
  const values = data.map(d => d.marketCap);
  const minVal = Math.min(...values) * 0.97;
  const maxVal = Math.max(...values) * 1.01;
  const current = data[data.length - 1];

  return (
    <div className="card chart-card">
      <div className="chart-header">
        <span className="card-title" style={{ margin: 0 }}>
          $DIRTY MARKET CAP — HOURLY
        </span>
        <span style={{ fontSize: 11, color: '#f59e0b', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>
          {fmtMcap(current.marketCap)}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="mcapGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1a35" vertical={false} />
          <XAxis
            dataKey="ts"
            tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            axisLine={false} tickLine={false}
            interval={tickInterval}
            tickFormatter={fmtTs}
          />
          <YAxis
            domain={[minVal, maxVal]}
            tick={{ fill: '#5a4575', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            axisLine={false} tickLine={false}
            tickFormatter={fmtMcap}
            width={62}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="marketCap"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#mcapGrad)"
            dot={false}
            activeDot={{ r: 4, fill: '#f59e0b' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
