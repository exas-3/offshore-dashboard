'use client';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = [
  '#c8a951', '#3ecf6a', '#4a9fd8', '#f5a623', '#9b6bd8',
  '#e05252', '#3ec8cf', '#cfb33e', '#7ecf3e', '#cf6b3e',
  '#4a5448',
];

function displayName(d) {
  if (d.label) return d.label;
  if (!d.address || d.address === 'Others') return 'Others';
  return `${d.address.slice(0, 6)}..${d.address.slice(-4)}`;
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{displayName(d)}</div>
      <div className="chart-tooltip-row">
        <span style={{ color: payload[0].fill }}>Balance</span>
        <span>{d.balance >= 1000 ? `${(d.balance / 1000).toFixed(1)}k` : d.balance.toFixed(0)} $DIRTY</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: payload[0].fill }}>Share</span>
        <span>{d.pct.toFixed(2)}%</span>
      </div>
      {d.isContract && <div style={{ color: '#7a8a78', fontSize: 10, marginTop: 4 }}>[CONTRACT]</div>}
    </div>
  );
};

const CustomLegend = ({ payload }) => (
  <div className="conc-legend">
    {payload.map((p, i) => (
      <div key={i} className="conc-legend-item">
        <span className="conc-legend-dot" style={{ background: p.color }} />
        <span className="conc-legend-label">{displayName(p.payload)}</span>
        <span className="conc-legend-pct">{p.payload.pct.toFixed(1)}%</span>
      </div>
    ))}
  </div>
);

export default function ConcentrationChart({ concentration, loading }) {
  if (loading || !concentration?.length) {
    return (
      <div className="card conc-card">
        <div className="card-title">SUPPLY CONCENTRATION</div>
        <div className="placeholder-rows">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="placeholder-row" />)}
        </div>
      </div>
    );
  }

  const data = concentration.map(d => ({ ...d, name: d.address }));

  return (
    <div className="card conc-card">
      <div className="card-title">SUPPLY CONCENTRATION</div>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="balance"
            nameKey="name"
            cx="50%"
            cy="45%"
            innerRadius={55}
            outerRadius={90}
            paddingAngle={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            content={<CustomLegend />}
            layout="vertical"
            align="right"
            verticalAlign="middle"
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
