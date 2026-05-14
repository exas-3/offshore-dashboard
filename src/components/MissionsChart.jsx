'use client';
import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const GREEN  = '#3ecf6a';
const ORANGE = '#f5a623';

function fmtNum(n) {
  n = Number(n);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtTs(ts, hourly) {
  const d = new Date(ts * 1000);
  if (hourly) return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function buildData(raw) {
  return (raw ?? []).map(d => ({
    ts:             d.ts,
    completed:      d.drugDeal + d.armsDeal + d.extortion,
    failed:         d.partial,
    completedDirty: d.drugDealDirty + d.armsDealDirty + d.extortionDirty,
    failedDirty:    d.partialDirty,
  }));
}

function sliceData(data, view, range) {
  if (!data?.length || range === 'all') return data ?? [];
  const days = range === '1d' ? 1 : range === '3d' ? 3 : 7;
  return data.slice(-(view === 'hourly' ? days * 24 : days));
}

const Tooltip_ = ({ active, payload, label, hourly }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const total   = d.completed + d.failed;
  const winRate = total > 0 ? ((d.completed / total) * 100).toFixed(1) : null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{fmtTs(label, hourly)}</div>
      {winRate && (
        <div className="chart-tooltip-row">
          <span style={{ color: 'var(--text-2)' }}>Win rate</span>
          <span style={{ color: GREEN, fontWeight: 600 }}>{winRate}%</span>
        </div>
      )}
      <div className="chart-tooltip-row">
        <span style={{ color: GREEN }}>Completed</span>
        <span>{d.completed.toLocaleString()}</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: ORANGE }}>Failed</span>
        <span>{d.failed.toLocaleString()}</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: GREEN }}>Completed $DIRTY</span>
        <span>{fmtNum(d.completedDirty)}</span>
      </div>
      <div className="chart-tooltip-row">
        <span style={{ color: ORANGE }}>Failed $DIRTY</span>
        <span>{fmtNum(d.failedDirty)}</span>
      </div>
    </div>
  );
};

const Legend_ = ({ payload }) => (
  <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 4 }}>
    {payload.map((p, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-2)' }}>
        <span style={{ width: 10, height: 10, background: p.color, borderRadius: 2, display: 'inline-block' }} />
        {p.value}
      </div>
    ))}
  </div>
);

export default function MissionsChart({ dailyOpBreakdown, hourlyOpBreakdown, missionStats, loading }) {
  const [view,  setView]  = useState('daily');
  const [range, setRange] = useState('all');
  const [mode,  setMode]  = useState('count');

  const raw     = view === 'daily' ? dailyOpBreakdown : hourlyOpBreakdown;
  const chartData = buildData(sliceData(raw, view, range));
  const isEmpty = !chartData.length || chartData.every(d => d.completed + d.failed === 0);

  const tickInterval = view === 'hourly' ? Math.max(1, Math.floor(chartData.length / 12)) : 0;
  const maxBarSize   = view === 'daily' ? 60 : 10;
  const isCount      = mode === 'count';

  const totals = useMemo(() => {
    if (!missionStats?.length) return { completed: 0, failed: 0, completedDirty: 0, failedDirty: 0 };
    const done   = missionStats.filter(r => r.opType !== 'PARTIAL');
    const failed = missionStats.find(r => r.opType === 'PARTIAL');
    return {
      completed:     done.reduce((s, r) => s + r.count, 0),
      failed:        failed?.count ?? 0,
      completedDirty: done.reduce((s, r) => s + r.totalDirty, 0),
      failedDirty:   failed?.totalDirty ?? 0,
    };
  }, [missionStats]);

  const total = totals.completed + totals.failed;
  const completedPct = total > 0 ? ((totals.completed / total) * 100).toFixed(1) : null;
  const failedPct    = total > 0 ? ((totals.failed    / total) * 100).toFixed(1) : null;

  return (
    <div className="card chart-card">

      {/* header */}
      <div className="chart-header">
        <span className="card-title" style={{ margin: 0 }}>
          MISSIONS — {view === 'daily' ? 'DAILY' : 'HOURLY'}
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="chart-toggle">
            <button className={`toggle-btn ${mode === 'count' ? 'toggle-btn--active' : ''}`} onClick={() => setMode('count')}>Ops</button>
            <button className={`toggle-btn ${mode === 'dirty' ? 'toggle-btn--active' : ''}`} onClick={() => setMode('dirty')}>$DIRTY</button>
          </div>
          <div className="chart-toggle">
            {['all','7d','3d','1d'].map(r => (
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

      {/* chart body */}
      {loading ? (
        <div className="feed-empty" style={{ height: 220 }}>Loading…</div>
      ) : isEmpty ? (
        <div className="feed-empty" style={{ height: 220 }}>No mission data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1a35" vertical={false} />
            <XAxis
              dataKey="ts"
              tick={{ fill: '#5a4575', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={false} tickLine={false}
              interval={tickInterval}
              tickFormatter={ts => fmtTs(ts, view === 'hourly')}
            />
            <YAxis
              tick={{ fill: '#5a4575', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={false} tickLine={false}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            />
            <Tooltip content={<Tooltip_ hourly={view === 'hourly'} />} />
            <Legend content={<Legend_ />} />
            <Bar dataKey={isCount ? 'completed' : 'completedDirty'} name="Ops Completed"    stackId="a" fill={GREEN}  maxBarSize={maxBarSize} />
            <Bar dataKey={isCount ? 'failed'    : 'failedDirty'}    name="Operation Failed" stackId="a" fill={ORANGE} maxBarSize={maxBarSize} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* summary stats */}
      {completedPct && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0 10px' }} />
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
              TOTAL <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtNum(total)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
              COMPLETED <span style={{ color: GREEN, fontWeight: 600 }}>{completedPct}%</span>
              <span style={{ marginLeft: 6 }}>({fmtNum(totals.completedDirty)} $DIRTY)</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)' }}>
              FAILED <span style={{ color: ORANGE, fontWeight: 600 }}>{failedPct}%</span>
              <span style={{ marginLeft: 6 }}>({fmtNum(totals.failedDirty)} $DIRTY)</span>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
