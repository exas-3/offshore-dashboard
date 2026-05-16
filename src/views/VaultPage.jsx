'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import VaultCycle from '../components/VaultCycle';
import { getVaultCycle } from '../api';

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
          <span style={{ color: p.fill }}>To Players</span>
          <span>{p.value.toLocaleString('en-US')} USDm</span>
        </div>
      ))}
    </div>
  );
};

export default function VaultPage() {
  const router = useRouter();
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [cycle, setCycle]       = useState(getVaultCycle());
  const [opBreakdown, setOpBreakdown] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setCycle(getVaultCycle()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(d => setOpBreakdown(d.opBreakdown ?? null))
      .catch(() => {});
  }, []);

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

  const stats       = data?.stats;
  const cycles      = data?.cycleHistory ?? [];
  const earners     = data?.topEarners   ?? [];
  const recent      = data?.recentPayouts ?? [];
  const topStakers  = data?.topStakers24h ?? [];

  return (
    <div className="vault-page">

      {/* ── current cycle ── */}
      <VaultCycle cycle={cycle} opBreakdown={opBreakdown} />

      {/* ── stat cards ── */}
      <div className="stats-row" style={{ marginTop: 16 }}>
        <div className="stat-card stat-card--gold">
          <div className="stat-label">TOTAL DISTRIBUTED</div>
          <div className="stat-value">{loading ? '—' : fmt(stats?.distributed)}</div>
          <div className="stat-sub">USDm to players</div>
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
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1a35" vertical={false} />
              <XAxis dataKey="label" tick={{ fill:'#5a4575', fontSize:10, fontFamily:'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:'#5a4575', fontSize:10, fontFamily:'JetBrains Mono' }} axisLine={false} tickLine={false}
                     tickFormatter={v => v>=1000?`${(v/1000).toFixed(0)}k`:v} />
              <Tooltip content={<CycleTooltip />} />
              <Bar dataKey="distributed" name="To Players" fill="#c084fc" maxBarSize={60} radius={[2,2,0,0]} />
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
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1a35" vertical={false} />
              <XAxis dataKey="label" tick={{ fill:'#5a4575', fontSize:10, fontFamily:'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:'#5a4575', fontSize:10, fontFamily:'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v=>[v,'Recipients']} labelStyle={{color:'var(--text-2)'}} itemStyle={{color:'#4a9fd8'}} contentStyle={{background:'#0e0c1a',border:'1px solid var(--border-2)',borderRadius:4,fontFamily:'var(--mono)',fontSize:11}} />
              <Bar dataKey="recipients" fill="#4a9fd8" maxBarSize={60} radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── new recipients per cycle ── */}
      <div className="card chart-card" style={{ marginTop: 16 }}>
        <div className="chart-header">
          <span className="card-title" style={{ margin: 0 }}>NEW RECIPIENTS PER CYCLE</span>
        </div>
        {cycles.length === 0 ? (
          <div className="feed-empty" style={{ height: 160 }}>No data</div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={cycles} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1a35" vertical={false} />
              <XAxis dataKey="label" tick={{ fill:'#5a4575', fontSize:10, fontFamily:'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:'#5a4575', fontSize:10, fontFamily:'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={v=>[v,'New recipients']} labelStyle={{color:'var(--text-2)'}} itemStyle={{color:'#3ecf6a'}} contentStyle={{background:'#0e0c1a',border:'1px solid var(--border-2)',borderRadius:4,fontFamily:'var(--mono)',fontSize:11}} />
              <Bar dataKey="newRecipients" fill="#3ecf6a" maxBarSize={60} radius={[2,2,0,0]} />
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
                      <span className="earner-addr" style={{ cursor:'pointer' }} onClick={() => router.push(`/players/${e.addr}`)}>
                        {shortAddr(e.addr)}
                      </span>
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
                    <span className="feed-addr" style={{ cursor:'pointer' }} onClick={() => router.push(`/players/${p.recipient}`)}>
                      {shortAddr(p.recipient)}
                    </span>
                    <span className="feed-amount">{fmt(p.amount)} USDm</span>
                    <span className="feed-time" suppressHydrationWarning>{timeAgo(p.timestamp)}</span>
                    <a href={`https://mega.etherscan.io/tx/${p.hash}`} target="_blank" rel="noopener noreferrer" className="feed-link">{'[->'}{']'}</a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ── top stakers last 24h ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">TOP STAKERS — LAST 24H</div>
        {loading ? (
          <div className="placeholder-rows">{Array.from({length:5}).map((_,i)=><div key={i} className="placeholder-row"/>)}</div>
        ) : topStakers.length === 0 ? (
          <div className="feed-empty">No staking activity in the last 24h</div>
        ) : (
          <div className="earners-table-wrap">
            <div className="earners-head">
              <span>#</span><span>ADDRESS</span><span>DIRTY STAKED</span><span>DEPOSITS</span><span></span>
            </div>
            <div className="earners-body">
              {topStakers.map((s, i) => {
                const max = topStakers[0]?.total ?? 1;
                return (
                  <div key={s.addr} className="earners-row">
                    <span className="earner-rank">#{i+1}</span>
                    <span className="earner-addr" style={{ cursor:'pointer' }} onClick={() => router.push(`/players/${s.addr}`)}>
                      {shortAddr(s.addr)}
                    </span>
                    <span className="earner-total">{fmt(s.total)}</span>
                    <span className="earner-ops">{s.deposits}</span>
                    <div className="earner-bar-wrap">
                      <div className="earner-bar" style={{ width: `${(s.total/max)*100}%`, background: '#4a9fd8' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
