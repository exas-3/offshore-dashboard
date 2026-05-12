'use client';
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(2);
}

function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

function timeAgo(ts) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (d < 60)    return `${d}s ago`;
  if (d < 3600)  return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

const CycleTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      {payload.map(p => p.value > 0 && (
        <div key={p.dataKey} className="chart-tooltip-row">
          <span style={{ color: p.fill }}>{p.name}</span>
          <span>{p.value.toLocaleString()} USDm</span>
        </div>
      ))}
    </div>
  );
};

export default function VaultPage() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/vault')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
    const t = setInterval(() => {
      fetch('/api/vault').then(r => r.json()).then(setData).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const stats   = data?.stats;
  const cycles  = data?.cycleHistory ?? [];
  const earners = data?.topEarners   ?? [];
  const recent  = data?.recentPayouts ?? [];

  return (
    <div className="vault-page">

      {/* ── stat cards ── */}
      <div className="stats-row">
        <div className="stat-card stat-card--gold">
          <div className="stat-label">TOTAL DISTRIBUTED</div>
          <div className="stat-value">{loading ? '—' : fmt(stats?.distributed)}</div>
          <div className="stat-sub">USDm to players</div>
        </div>
        <div className="stat-card stat-card--red">
          <div className="stat-label">TOTAL BURNED</div>
          <div className="stat-value">{loading ? '—' : fmt(stats?.burned)}</div>
          <div className="stat-sub">USDm to 0x0</div>
        </div>
        <div className="stat-card stat-card--green">
          <div className="stat-label">CYCLES PAID</div>
          <div className="stat-value">{loading ? '—' : stats?.cyclesPaid ?? '—'}</div>
          <div className="stat-sub">cycles with payouts</div>
        </div>
        <div className="stat-card stat-card--amber">
          <div className="stat-label">UNIQUE RECIPIENTS</div>
          <div className="stat-value">{loading ? '—' : stats?.uniqueRecipients ?? '—'}</div>
          <div className="stat-sub">wallets ever paid</div>
        </div>
      </div>

      {/* ── payout per cycle chart ── */}
      <div className="card chart-card" style={{ marginTop: 16 }}>
        <div className="chart-header">
          <span className="card-title" style={{ margin: 0 }}>USDm DISTRIBUTED PER CYCLE</span>
        </div>
        {cycles.length === 0 ? (
          <div className="feed-empty" style={{ height: 220 }}>No cycle data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cycles} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a241a" vertical={false} />
              <XAxis dataKey="label" tick={{ fill:'#4a5448', fontSize:10, fontFamily:'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:'#4a5448', fontSize:10, fontFamily:'JetBrains Mono' }} axisLine={false} tickLine={false}
                     tickFormatter={v => v>=1000?`${(v/1000).toFixed(0)}k`:v} />
              <Tooltip content={<CycleTooltip />} />
              <Legend formatter={v => v==='distributed'?'To Players':'Burned to 0x0'} />
              <Bar dataKey="distributed" name="distributed" stackId="a" fill="#c8a951" maxBarSize={60} />
              <Bar dataKey="burned"      name="burned"      stackId="a" fill="#e05252" maxBarSize={60} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── recipients per cycle ── */}
      <div className="card chart-card" style={{ marginTop: 16 }}>
        <div className="chart-header">
          <span className="card-title" style={{ margin: 0 }}>RECIPIENTS PER CYCLE</span>
        </div>
        {cycles.length === 0 ? (
          <div className="feed-empty" style={{ height: 160 }}>No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={cycles} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a241a" vertical={false} />
              <XAxis dataKey="label" tick={{ fill:'#4a5448', fontSize:10, fontFamily:'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:'#4a5448', fontSize:10, fontFamily:'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v=>[v,'Recipients']} labelStyle={{color:'var(--text)'}} contentStyle={{background:'var(--card)',border:'1px solid var(--border)'}} />
              <Bar dataKey="recipients" fill="#4a9fd8" maxBarSize={60} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── bottom grid: top earners + recent payouts ── */}
      <div className="bottom-grid" style={{ marginTop: 16 }}>

        {/* top earners */}
        <div className="card earners-card">
          <div className="card-title">TOP VAULT EARNERS — ALL TIME</div>
          {loading ? (
            <div className="placeholder-rows">{Array.from({length:8}).map((_,i)=><div key={i} className="placeholder-row"/>)}</div>
          ) : (
            <div className="earners-table-wrap">
              <div className="earners-head">
                <span>#</span><span>ADDRESS</span><span>USDm EARNED</span><span>PAYOUTS</span><span></span>
              </div>
              <div className="earners-body">
                {earners.map((e, i) => {
                  const max = earners[0]?.total ?? 1;
                  return (
                    <div key={e.addr} className="earners-row">
                      <span className="earner-rank">#{i+1}</span>
                      <a href={`https://mega.etherscan.io/address/${e.addr}`} target="_blank" rel="noopener noreferrer" className="earner-addr">
                        {shortAddr(e.addr)}
                      </a>
                      <span className="earner-total">{fmt(e.total)}</span>
                      <span className="earner-ops">{e.payouts}</span>
                      <div className="earner-bar-wrap">
                        <div className="earner-bar" style={{ width: `${(e.total/max)*100}%`, background:'var(--gold)' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* recent payouts feed */}
        <div className="card feed-card">
          <div className="card-title">RECENT VAULT PAYOUTS</div>
          {loading ? (
            <div className="placeholder-rows">{Array.from({length:8}).map((_,i)=><div key={i} className="placeholder-row"/>)}</div>
          ) : (
            <div className="feed-table">
              <div className="feed-head">
                <span>RECIPIENT</span><span>AMOUNT</span><span>WHEN</span><span>TX</span>
              </div>
              <div className="feed-body">
                {recent.map(p => (
                  <div key={`${p.hash}:${p.log_index}`} className="feed-row feed-row--gold">
                    <span className="feed-addr">{shortAddr(p.recipient)}</span>
                    <span className="feed-amount">{fmt(p.amount)} USDm</span>
                    <span className="feed-time">{timeAgo(p.timestamp)}</span>
                    <a href={`https://mega.etherscan.io/tx/${p.hash}`} target="_blank" rel="noopener noreferrer" className="feed-link">{'[->'}{']'}</a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
