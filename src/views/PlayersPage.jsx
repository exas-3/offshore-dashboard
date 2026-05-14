'use client';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import FarmersTable from '../components/FarmersTable';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

// ── helpers ──────────────────────────────────────────────────────────────────

function shortAddr(a) {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtD(n) {
  if (!n) return '0';
  n = Number(n);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function fmtUsd(n) {
  if (!n) return '—';
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function pct(part, total) {
  if (!total) return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function absTime(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function fmtCountdown(ts) {
  if (!ts) return '—';
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'ended';
  if (diff < 60)   return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

function fmtPrice(raw) {
  if (!raw || raw === '0') return '—';
  try {
    const n = Number(BigInt(raw) / 10n ** 12n) / 1e6;
    return n > 0 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
  } catch { return '—'; }
}

const OP_LABELS = {
  DRUG_DEAL: 'Ops Completed', ARMS_DEAL: 'Ops Completed', EXTORTION: 'Ops Completed',
  THIRD_ENTERPRISE: 'Ops Completed',
  PARTIAL: 'Operation Failed', FAIL: 'Failed', LEVEL_UP: 'Level Up', BUY_ASSET: 'Buy Asset',
  BURN: 'Protocol Burn', DEX_BUY: 'Buy', DEX_SELL: 'Sell', SCRAP: 'Scrap Item',
};

const OP_COLORS = {
  DRUG_DEAL: '#3ecf6a', ARMS_DEAL: '#3ecf6a', EXTORTION: '#3ecf6a',
  THIRD_ENTERPRISE: '#3ecf6a',
  PARTIAL: '#f5a623', FAIL: '#555', LEVEL_UP: '#d946ef', BUY_ASSET: '#e0a030',
  BURN: '#e05252', DEX_BUY: '#3ecf6a', DEX_SELL: '#e05252', SCRAP: '#f59e0b',
};

const DEX_POOLS = new Set([
  '0xf9f676066eb7baeeed93e859bc26a41663f277a8',
  '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1',
  '0x5e3ae52eba0f9740364bd5dd39738e1336086a8b', // Kumbaya exchange/router
]);

function classifyRow(row, address) {
  const { kind, op_type, from_addr, to_addr } = row;
  // DEX check takes priority over kind/op_type so SPEND/BUY_ASSET to a pool shows as Sell
  if (op_type === 'DEX_SELL' || DEX_POOLS.has(to_addr))   return { label: 'Sell', color: '#e05252', dir: '-' };
  if (op_type === 'DEX_BUY'  || DEX_POOLS.has(from_addr)) return { label: 'Buy',  color: '#3ecf6a', dir: '+' };
  if (kind === 'MINT')  return { label: OP_LABELS[op_type] ?? op_type, color: OP_COLORS[op_type] ?? '#3ecf6a', dir: '+' };
  if (kind === 'SPEND') return { label: OP_LABELS[op_type] ?? op_type, color: OP_COLORS[op_type] ?? '#c084fc', dir: '-' };
  if (kind === 'BURN')  return { label: 'Protocol Burn', color: '#e05252', dir: '-' };
  if (kind === 'TRANSFER') {
    if (to_addr === address)   return { label: 'Received', color: '#4a9fd8', dir: '+' };
    if (from_addr === address) return { label: 'Sent',     color: '#888',    dir: '-' };
  }
  return { label: kind, color: '#888', dir: '' };
}

// ── sub-components ───────────────────────────────────────────────────────────

function StatusPill({ on, labelOn, labelOff, variant }) {
  const color = on
    ? (variant === 'red' ? 'status-dot--red' : variant === 'amber' ? 'status-dot--amber' : 'status-dot--green')
    : 'status-dot--off';
  return <span className={`status-dot ${color}`}>{on ? labelOn : labelOff}</span>;
}

function StatBox({ label, value, color = 'var(--text)', sub }) {
  return (
    <div style={{ background: 'var(--bg-2)', borderRadius: 6, padding: '10px 14px', minWidth: 110 }}>
      <div style={{ fontSize: 9, color: 'var(--text-2)', letterSpacing: '0.08em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontFamily: 'JetBrains Mono', color, fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: 'var(--text-2)', letterSpacing: '0.1em', marginBottom: 8, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function HistoryChart({ history }) {
  if (!history?.length) return null;

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const by = Object.fromEntries(payload.map(p => [p.dataKey, p.value]));
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-row"><span style={{ color: '#3ecf6a' }}>Earned</span><span>{(by.earned ?? 0).toLocaleString('en-US')}</span></div>
        <div className="chart-tooltip-row"><span style={{ color: '#e05252' }}>Spent</span><span>{(by.spent ?? 0).toLocaleString('en-US')}</span></div>
        <div className="chart-tooltip-row"><span style={{ color: '#888' }}>Ops</span><span>{by.ops ?? 0}</span></div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={history} margin={{ top: 4, right: 8, left: -10, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="#1e1a35" vertical={false} />
        <XAxis dataKey="day" tick={{ fill: '#5a4575', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false}
          tickFormatter={d => { const p = d.split('-'); return `${parseInt(p[1])}/${parseInt(p[2])}`; }} />
        <YAxis tick={{ fill: '#5a4575', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false}
          tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="earned" fill="#3ecf6a" maxBarSize={40} radius={[2,2,0,0]} />
        <Bar dataKey="spent"  fill="#e05252" maxBarSize={40} radius={[2,2,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Alarm sounds ─────────────────────────────────────────────────────────────

const SOUND_SUCCESS = '/sounds/success.mp3';
const SOUND_PARTIAL = '/sounds/partial.mp3';

function playSuccessSound() {
  try { new Audio(SOUND_SUCCESS).play(); } catch {}
}

function playPartialSound() {
  try { new Audio(SOUND_PARTIAL).play(); } catch {}
}

function triggerAlarm(kind, companyAddr) {
  if (kind === 'success') playSuccessSound();
  else playPartialSound();
  if (typeof document !== 'undefined' && document.hidden &&
      typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(kind === 'success' ? '✅ Op Completed' : '⚠ Partial Op', {
      body: `${companyAddr.slice(0, 10)}… — ${kind === 'success' ? 'operation succeeded' : 'partial reward'}`,
      silent: true,
    });
  }
}

function requestNotifPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// Inline Web Worker source — runs the poll timer off the main thread so Chrome's
// background tab throttling doesn't delay alarm checks.
const POLL_WORKER_SRC = `
  let t = null;
  onmessage = e => {
    if (e.data === 'start') { clearInterval(t); t = setInterval(() => postMessage('tick'), 10000); }
    else if (e.data === 'stop') { clearInterval(t); t = null; }
  };
`;

// ── PlayerDetail ──────────────────────────────────────────────────────────────

function PlayerDetail({ address, onBack }) {
  const [dbData,  setDbData]  = useState(null);
  const [live,    setLive]    = useState(null);
  const [dbLoad,  setDbLoad]  = useState(true);
  const [liveLoad,setLiveLoad]= useState(true);
  const [actTab,  setActTab]  = useState('all');
  const [actPage, setActPage] = useState(0);

  const [alarmAll, setAlarmAll] = useState(false);
  const [alarmSet, setAlarmSet] = useState(new Set());
  const alarmAllRef = useRef(false);
  const alarmSetRef = useRef(new Set());
  const prevCompRef = useRef({});
  const workerRef   = useRef(null);
  const [liveEthPrice, setLiveEthPrice] = useState(null);
  const [, setTick] = useState(0);

  // Re-render every second so fmtCountdown() stays accurate without re-fetching
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/eth-price/stream');
    es.onmessage = (e) => {
      const p = parseFloat(e.data);
      if (!isNaN(p)) setLiveEthPrice(p);
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, []);

  const anyAlarm = alarmAll || alarmSet.size > 0;

  const toggleAlarmAll = () => {
    const next = !alarmAllRef.current;
    alarmAllRef.current = next;
    if (next) requestNotifPermission();
    else { alarmSetRef.current = new Set(); setAlarmSet(new Set()); }
    setAlarmAll(next);
  };

  const fetchDb = useCallback(() => {
    setDbLoad(true);
    fetch(`/api/players/${address}`)
      .then(r => r.json())
      .then(d => { setDbData(d); setDbLoad(false); })
      .catch(() => setDbLoad(false));
  }, [address]);

  const fetchLive = useCallback(() => {
    setLiveLoad(true);
    fetch(`/api/monitor?wallet=${address}`)
      .then(r => r.json())
      .then(d => {
        if (!d.error) {
          const companies = d.companies ?? [];
          const prev = prevCompRef.current;
          companies.forEach(c => {
            const p = prev[c.company];
            if (!p) return;
            const watched = alarmAllRef.current || alarmSetRef.current.has(c.company);
            if (!watched) return;
            if (!p.completable && c.completable) triggerAlarm('success', c.company);
            else if (p.active && !c.active && !c.completable && !p.completable) triggerAlarm('partial', c.company);
          });
          prevCompRef.current = Object.fromEntries(
            companies.map(c => [c.company, { active: c.active, completable: c.completable }])
          );
        }
        setLive(d.error ? null : d);
        setLiveLoad(false);
      })
      .catch(() => setLiveLoad(false));
  }, [address]);

  useEffect(() => {
    if (!anyAlarm) {
      if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
      return;
    }
    const blob = new Blob([POLL_WORKER_SRC], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);
    const w    = new Worker(url);
    w.onmessage = () => fetchLive();
    w.postMessage('start');
    workerRef.current = w;
    return () => { w.terminate(); workerRef.current = null; URL.revokeObjectURL(url); };
  }, [anyAlarm, fetchLive]);

  useEffect(() => {
    setDbData(null);
    setLive(null);
    prevCompRef.current = {};
    fetchDb();
    fetchLive();
  }, [address, fetchDb, fetchLive]);

  const { stats, activity, vault, breakdown, history, influence, recentMissions } = dbData ?? {};
  const net         = (stats?.earned ?? 0) + (stats?.dex_bought ?? 0) - (stats?.spent ?? 0) - (stats?.dex_sold ?? 0);
  const totalEarned = stats?.earned ?? 0;
  const totalSpent  = stats?.spent  ?? 0;

  const MISSION_TYPES  = new Set(['DRUG_DEAL', 'ARMS_DEAL', 'EXTORTION', 'THIRD_ENTERPRISE', 'PARTIAL', 'FAIL']);
  const SUCCESS_TYPES  = new Set(['DRUG_DEAL', 'ARMS_DEAL', 'EXTORTION', 'THIRD_ENTERPRISE']);

  // Merge completed op types and rename partial for display
  const earnedByCategory = (() => {
    if (!breakdown?.earned?.length) return [];
    let compCnt = 0, compTotal = 0, failCnt = 0, failTotal = 0;
    const others = [];
    for (const r of breakdown.earned) {
      if (SUCCESS_TYPES.has(r.op_type)) { compCnt += r.cnt; compTotal += r.total; }
      else if (r.op_type === 'PARTIAL') { failCnt += r.cnt; failTotal += r.total; }
      else others.push(r);
    }
    const result = [];
    if (compCnt  > 0) result.push({ op_type: '_COMPLETED', label: 'Ops Completed',    color: '#3ecf6a', cnt: compCnt,  total: compTotal });
    if (failCnt  > 0) result.push({ op_type: '_FAILED',    label: 'Operation Failed',  color: '#f5a623', cnt: failCnt,  total: failTotal });
    others.forEach(r => result.push({ ...r, label: OP_LABELS[r.op_type] ?? r.op_type, color: OP_COLORS[r.op_type] ?? '#888' }));
    return result;
  })();
  const missionRows    = (breakdown?.earned ?? []).filter(r => MISSION_TYPES.has(r.op_type));
  const totalMissions  = missionRows.reduce((s, r) => s + r.cnt, 0);
  const successCount   = missionRows.filter(r => SUCCESS_TYPES.has(r.op_type)).reduce((s, r) => s + r.cnt, 0);
  const partialCount   = missionRows.find(r => r.op_type === 'PARTIAL')?.cnt ?? 0;
  const failCount      = missionRows.find(r => r.op_type === 'FAIL')?.cnt ?? 0;
  const successRate    = totalMissions > 0 ? (successCount / totalMissions * 100).toFixed(1) : null;

  function recentRate(field) {
    if (!recentMissions?.length) return null;
    const total   = recentMissions.reduce((s, r) => s + Number(r[field]), 0);
    const success = recentMissions
      .filter(r => SUCCESS_TYPES.has(r.op_type))
      .reduce((s, r) => s + Number(r[field]), 0);
    return total > 0 ? { rate: (success / total * 100).toFixed(1), total } : null;
  }
  const rate6h  = recentRate('cnt_6h');
  const rate24h = recentRate('cnt_24h');

  const liveCompanies = live?.companies ?? [];
  const liveAlerts = liveCompanies.filter(c => c.liquidatable);

  const actFiltered = actTab === 'all'   ? (activity ?? [])
    : actTab === 'earn'  ? (activity ?? []).filter(r => r.kind === 'MINT')
    : actTab === 'spend' ? (activity ?? []).filter(r => r.kind === 'SPEND' || r.kind === 'BURN')
    : actTab === 'dex'   ? (activity ?? []).filter(r => r.kind === 'TRANSFER' && (r.to_addr === LP || r.from_addr === LP))
    : (activity ?? []);

  const ACT_PAGE_SIZE = 69;
  const actTotalPages = Math.max(1, Math.ceil(actFiltered.length / ACT_PAGE_SIZE));
  const actPage0 = Math.min(actPage, actTotalPages - 1);
  const actPageRows = actFiltered.slice(actPage0 * ACT_PAGE_SIZE, (actPage0 + 1) * ACT_PAGE_SIZE);

  return (
    <div>
      <button className="toggle-btn" onClick={onBack} style={{ marginBottom: 16 }}>← All Players</button>

      {/* wallet header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <a href={`https://mega.etherscan.io/address/${address}`} target="_blank" rel="noopener noreferrer"
           style={{ color: 'var(--gold)', fontFamily: 'JetBrains Mono', fontSize: 13, wordBreak: 'break-all' }}>
          {address}
        </a>
        {stats && (
          <span style={{ fontSize: 10, color: 'var(--text-2)', marginLeft: 'auto' }} suppressHydrationWarning>
            Active {absTime(stats.first_active)} → {timeAgo(stats.last_active)}
          </span>
        )}
      </div>

      {/* ── INDEXED STATS ────────────────────────────────────────────────── */}
      {stats && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: 'var(--text-2)', letterSpacing: 2, marginBottom: 10 }}>INDEXED STATS</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <StatBox label="TOTAL OPS"     value={(stats.ops ?? 0).toLocaleString('en-US')}  color="var(--gold)" />
            <StatBox label="DIRTY EARNED"  value={fmtD(totalEarned)}       color="var(--green)" />
            <StatBox label="DIRTY SPENT"   value={fmtD(totalSpent)}        color="var(--red)" />
            <StatBox label="INF BOUGHT"    value={(influence?.totalPurchased ?? 0).toLocaleString('en-US')} color="orange"
              sub={influence?.purchaseCount > 0 ? `${influence.purchaseCount} purchases` : undefined} />
            <StatBox label="INF REFUNDED"  value={(influence?.totalRefunded ?? 0).toLocaleString('en-US')} color="var(--green)" />
            <StatBox label="DEX SOLD"      value={fmtD(stats.dex_sold)}    color="#e05252"
              sub={stats.dex_sold > 0 ? `${breakdown?.dex_sold?.cnt ?? 0} txs` : undefined} />
            <StatBox label="DEX BOUGHT"    value={fmtD(stats.dex_bought)}  color="#3ecf6a"
              sub={stats.dex_bought > 0 ? `${breakdown?.dex_bought?.cnt ?? 0} txs` : undefined} />
            <StatBox label="VAULT CLAIMED" value={fmtUsd(stats.vault_claimed)} color="var(--gold)"
              sub={stats.vault_count > 0 ? `${stats.vault_count} payouts` : undefined} />
            <StatBox label="BALANCE"       value={fmtD(stats.balance)}     color="var(--text)" />
          </div>
        </div>
      )}

      {/* ── LIVE RPC section ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="chart-header" style={{ marginBottom: 10 }}>
          <span style={{ fontSize: 10, letterSpacing: 2, color: 'var(--text-2)' }}>LIVE ON-CHAIN</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className={`toggle-btn ${alarmAll ? 'toggle-btn--active' : ''}`}
              onClick={toggleAlarmAll}
              style={{ fontSize: 10, padding: '3px 10px' }}
              title="Alert on any operation completion"
            >
              {alarmAll ? '🔔 ALL ON' : '🔔 SET ALL ALARMS'}
            </button>
          </div>
        </div>

        {liveLoad && !live ? (
          <div style={{ color: 'var(--text-3)', fontSize: 11, padding: '8px 0' }}>Fetching live data…</div>
        ) : !live ? (
          <div style={{ color: 'var(--red)', fontSize: 11 }}>Could not fetch live data</div>
        ) : (
          <>
            {/* alert banners */}
            {liveAlerts.length > 0 && (
              <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {liveAlerts.map(c => (
                  <div key={c.company} style={{ background: 'rgba(224,82,82,0.08)', border: '1px solid var(--red-dim)', borderRadius: 5, padding: '6px 12px', fontSize: 11, color: 'var(--red)' }}>
                    ⚠ LIQUIDATABLE — {c.company}
                  </div>
                ))}
              </div>
            )}

            {/* balance cards */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: liveCompanies.length ? 12 : 0 }}>
              <StatBox label="INFLUENCE" value={fmtD(live.influenceBalance)} color="var(--gold)" sub="$INFLUENCE held" />
              <StatBox label="DIRTY BAL" value={fmtD(live.dirtyBalance)} color="#c084fc" sub="$DIRTY held" />
              {live.infCost != null && (
                <StatBox label="OP COST" value={`${live.infCost.toFixed(2)} INF`} color="orange" sub="last trade" />
              )}
              <StatBox label="COMPANIES" value={live.summary?.total ?? 0} color="var(--green)"
                sub={`${live.summary?.activeCount ?? 0} active · ${live.summary?.autoTradeOn ?? 0} auto-on`} />
              {live.summary?.liquidatable > 0
                ? <StatBox label="STATUS" value={`${live.summary.liquidatable} LIQ`} color="var(--red)" sub="at risk" />
                : <StatBox label="STATUS" value="OK" color="var(--green)" sub="nominal" />
              }
            </div>

            {/* companies table */}
            {liveCompanies.length > 0 && (
              <div className="companies-table-wrap" style={{ marginTop: 4 }}>
                <div className="companies-head">
                  <span>COMPANY</span><span>AUTO</span><span>ACTIVE</span>
                  <span>ENDS IN</span>
                  <span>LIQ PRICE</span><span>ETH PRICE / BUFFER</span><span>ENTRY</span><span>⚡</span><span>→</span>
                </div>
                <div className="companies-body">
                  {liveCompanies.map(c => (
                    <div key={c.company} className="companies-row"
                      style={c.liquidatable ? { background: 'rgba(224,82,82,0.05)' } : {}}>
                      <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{shortAddr(c.company)}</span>
                      <StatusPill on={c.autoTradeEnabled} labelOn="ON"  labelOff="OFF" />
                      <StatusPill on={c.active}           labelOn="YES" labelOff="NO" />
                      <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{c.active ? fmtCountdown(c.endTime) : '—'}</span>
                      <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{fmtPrice(c.liqPrice)}</span>
                      {(() => {
                        if (!liveEthPrice) return <span style={{ fontSize: 11, color: 'var(--text-3)' }}>—</span>;
                        try {
                          const liqNum = (c.liqPrice && c.liqPrice !== '0')
                            ? Number(BigInt(c.liqPrice) / 10n ** 12n) / 1e6
                            : null;
                          const diff = liqNum != null ? liveEthPrice - liqNum : null;
                          const pct  = (diff != null && liqNum > 0) ? (diff / liqNum) * 100 : Infinity;
                          const bufColor = pct <= 1 ? 'var(--red)' : pct <= 5 ? 'var(--amber)' : 'var(--green)';
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <span style={{ fontSize: 11, color: 'var(--blue)', fontFamily: 'JetBrains Mono' }}>{fmtUsd(liveEthPrice)}</span>
                              {diff != null && <span style={{ fontSize: 10, color: bufColor }}>{fmtUsd(diff)}</span>}
                            </div>
                          );
                        } catch { return <span style={{ fontSize: 11, color: 'var(--text-3)' }}>—</span>; }
                      })()}
                      <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{c.entryPrice > 0 ? fmtUsd(c.entryPrice) : '—'}</span>
                      <button
                        disabled={!c.active}
                        onClick={e => {
                          e.stopPropagation();
                          if (alarmAll) {
                            // Split from "all on": deactivate global, keep all other active companies individually
                            const next = new Set(
                              liveCompanies.filter(co => co.active && co.company !== c.company).map(co => co.company)
                            );
                            alarmAllRef.current = false;
                            alarmSetRef.current = next;
                            setAlarmAll(false);
                            setAlarmSet(next);
                          } else {
                            requestNotifPermission();
                            setAlarmSet(prev => {
                              const next = new Set(prev);
                              if (next.has(c.company)) next.delete(c.company); else next.add(c.company);
                              // If every active company is now armed, promote to "all on"
                              const activeAddrs = liveCompanies.filter(co => co.active).map(co => co.company);
                              if (activeAddrs.length > 0 && activeAddrs.every(a => next.has(a))) {
                                alarmAllRef.current = true;
                                alarmSetRef.current = new Set();
                                setAlarmAll(true);
                                return new Set();
                              }
                              alarmSetRef.current = next;
                              return next;
                            });
                          }
                        }}
                        style={{ background: 'none', border: 'none', padding: 0, fontSize: 13,
                                 cursor: c.active ? 'pointer' : 'default',
                                 color: !c.active ? 'var(--text-3)' : (alarmAll || alarmSet.has(c.company)) ? 'var(--amber)' : 'var(--text-3)',
                                 opacity: !c.active ? 0.3 : 1 }}
                        title={!c.active ? 'No active op' : (alarmAll || alarmSet.has(c.company)) ? 'Remove alarm' : 'Set alarm'}
                      >
                        {(alarmAll || alarmSet.has(c.company)) ? '🔔' : '🔕'}
                      </button>
                      <a href={`https://mega.etherscan.io/address/${c.company}`} target="_blank" rel="noopener noreferrer"
                         style={{ color: 'var(--text-3)', fontSize: 11, textDecoration: 'none' }}>[→]</a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── DB stats ──────────────────────────────────────────────────────── */}
      {dbLoad && !dbData ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 11 }}>Loading stats…</div>
      ) : !stats ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 11 }}>No on-chain data found for this address.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div className="card">
              <Section title="DIRTY EARNED BY OPERATION">
                {earnedByCategory.length ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-2)', fontSize: 10 }}>
                        <th style={{ textAlign: 'left',  padding: '3px 6px' }}>TYPE</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>OPS</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>DIRTY</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>SHARE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {earnedByCategory.map(r => (
                        <tr key={r.op_type} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px 6px' }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 6 }} />
                            {r.label}
                          </td>
                          <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>{r.cnt.toLocaleString('en-US')}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--green)' }}>{fmtD(r.total)}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>{pct(r.total, totalEarned)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <div className="feed-empty">No ops yet</div>}
              </Section>
            </div>

            <div className="card">
              <Section title="HOW DIRTY WAS SPENT">
                {breakdown?.spent?.length ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-2)', fontSize: 10 }}>
                        <th style={{ textAlign: 'left',  padding: '3px 6px' }}>TYPE</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>COUNT</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>DIRTY</th>
                        <th style={{ textAlign: 'right', padding: '3px 6px' }}>SHARE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.spent.map(r => (
                        <tr key={r.op_type} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px 6px' }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: OP_COLORS[r.op_type] ?? '#888', marginRight: 6 }} />
                            {OP_LABELS[r.op_type] ?? r.op_type}
                          </td>
                          <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>{r.cnt.toLocaleString('en-US')}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--red)' }}>{fmtD(r.total)}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>{pct(r.total, totalSpent)}</td>
                        </tr>
                      ))}
                      {(stats.dex_sold ?? 0) > 0 && (
                        <tr style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '4px 6px' }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#e05252', marginRight: 6 }} />DEX Sell
                          </td>
                          <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>{breakdown?.dex_sold?.cnt ?? '—'}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px', color: '#e05252' }}>{fmtD(stats.dex_sold)}</td>
                          <td style={{ textAlign: 'right', padding: '4px 6px', color: 'var(--text-2)' }}>—</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                ) : <div className="feed-empty">Nothing spent</div>}
              </Section>
            </div>
          </div>

          {history?.length > 1 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <Section title="$DIRTY FARMED OVER TIME (DAILY)">
                <HistoryChart history={history} />
              </Section>
            </div>
          )}

          {vault?.length > 0 && (
            <div className="card" style={{ marginBottom: 12 }}>
              <Section title={`VAULT PAYOUTS (${vault.length})`}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '5px 16px', fontSize: 11, fontFamily: 'JetBrains Mono' }}>
                  {vault.map(v => (
                    <React.Fragment key={`${v.hash}-${v.log_index}`}>
                      <span style={{ color: 'var(--text-2)' }} suppressHydrationWarning>{absTime(v.timestamp)}</span>
                      <a href={`https://mega.etherscan.io/tx/${v.hash}`} target="_blank" rel="noopener noreferrer"
                         style={{ color: 'var(--text-2)' }}>{v.hash.slice(0, 14)}…</a>
                      <span style={{ color: 'var(--gold)', textAlign: 'right' }}>{fmtUsd(v.amount)}</span>
                    </React.Fragment>
                  ))}
                </div>
              </Section>
            </div>
          )}

          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: 'var(--text-2)', letterSpacing: '0.1em' }}>ACTIVITY</span>
              <div className="chart-toggle" style={{ marginLeft: 8 }}>
                {[['all','All'], ['earn','Earned'], ['spend','Spent'], ['dex','DEX']].map(([k, l]) => (
                  <button key={k} className={`toggle-btn ${actTab === k ? 'toggle-btn--active' : ''}`}
                    onClick={() => { setActTab(k); setActPage(0); }} style={{ fontSize: 10 }}>{l}</button>
                ))}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center', fontSize: 10, fontFamily: 'JetBrains Mono', flexWrap: 'wrap' }}>
                {rate6h && (
                  <span style={{ color: 'var(--text-2)' }} title={`${rate6h.total} ops in last 6h`}>
                    6H <span style={{ color: 'var(--green)' }}>{rate6h.rate}%</span>
                  </span>
                )}
                {rate24h && (
                  <span style={{ color: 'var(--text-2)' }} title={`${rate24h.total} ops in last 24h`}>
                    24H <span style={{ color: 'var(--green)' }}>{rate24h.rate}%</span>
                  </span>
                )}
                {successRate != null && (
                  <span style={{ color: 'var(--text-2)' }}
                    title={`${successCount} success · ${partialCount} partial · ${failCount} fail out of ${totalMissions} missions`}>
                    ALL <span style={{ color: 'var(--green)' }}>{successRate}%</span>
                    {partialCount > 0 && <span style={{ color: 'var(--text-3)' }}> · {((partialCount / totalMissions) * 100).toFixed(1)}% partial</span>}
                    {failCount    > 0 && <span style={{ color: 'var(--red)'    }}> · {((failCount    / totalMissions) * 100).toFixed(1)}% fail</span>}
                  </span>
                )}
                <span style={{ color: 'var(--text-2)' }}>{actFiltered.length} events · p.{actPage0 + 1}/{actTotalPages}</span>
              </div>
            </div>
            <div>
              {actFiltered.length === 0
                ? <div className="feed-empty">No activity</div>
                : actPageRows.map(row => {
                    const { label, color, dir } = classifyRow(row, address);
                    return (
                      <div key={`${row.hash}-${row.log_index}`}
                        style={{ display: 'grid', gridTemplateColumns: '130px 1fr 110px 90px', gap: 8, padding: '5px 0',
                                 borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'JetBrains Mono', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-2)', fontSize: 10 }} suppressHydrationWarning>{timeAgo(row.timestamp)}</span>
                        <a href={`https://mega.etherscan.io/tx/${row.hash}`} target="_blank" rel="noopener noreferrer"
                           style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.hash.slice(0, 16)}…
                        </a>
                        <span style={{ color }}>{label}</span>
                        <span style={{ color, textAlign: 'right' }}>{dir}{fmtD(row.amount)}</span>
                      </div>
                    );
                  })
              }
              {actTotalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 10, fontSize: 11, fontFamily: 'JetBrains Mono' }}>
                  <button className="toggle-btn" onClick={() => setActPage(0)} disabled={actPage0 === 0} style={{ fontSize: 10 }}>«</button>
                  <button className="toggle-btn" onClick={() => setActPage(p => Math.max(0, p - 1))} disabled={actPage0 === 0} style={{ fontSize: 10 }}>‹</button>
                  <span style={{ color: 'var(--text-2)', minWidth: 80, textAlign: 'center' }}>{actPage0 + 1} / {actTotalPages}</span>
                  <button className="toggle-btn" onClick={() => setActPage(p => Math.min(actTotalPages - 1, p + 1))} disabled={actPage0 === actTotalPages - 1} style={{ fontSize: 10 }}>›</button>
                  <button className="toggle-btn" onClick={() => setActPage(actTotalPages - 1)} disabled={actPage0 === actTotalPages - 1} style={{ fontSize: 10 }}>»</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

const FILTER_INIT = { earnedMin: '', opsMin: '', netMin: '', companiesMin: '', liqOnly: false };


export default function PlayersPage({ initialAddress } = {}) {
  const router = useRouter();
  const [tab,      setTab]      = useState('search');
  const [players,  setPlayers]  = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(false);
  const [search,   setSearch]   = useState('');
  const [sort,     setSort]     = useState('earned');
  const [filters,  setFilters]  = useState(FILTER_INIT);
  const [page,     setPage]     = useState(0);
  const [farmers,  setFarmers]  = useState([]);
  const [farmLoad, setFarmLoad] = useState(false);

  const PAGE_SIZE = 100;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/players?limit=5000');
      const d = await r.json();
      setPlayers(d.players ?? []);
      setTotal(d.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFarmers = useCallback(async () => {
    setFarmLoad(true);
    try {
      const d = await fetch('/api/farmers?limit=200').then(r => r.json());
      setFarmers(Array.isArray(d) ? d : []);
    } finally {
      setFarmLoad(false);
    }
  }, []);

  useEffect(() => { if (tab === 'leaderboard') load(); }, [tab, load]);
  useEffect(() => { if (tab === 'farmers' && farmers.length === 0) loadFarmers(); }, [tab, farmers.length, loadFarmers]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.earnedMin)    n++;
    if (filters.opsMin)       n++;
    if (filters.netMin)       n++;
    if (filters.companiesMin) n++;
    if (filters.liqOnly)      n++;
    return n;
  }, [filters]);

  const visible = useMemo(() => {
    const f = filters;
    return players
      .filter(p => !search || p.addr.toLowerCase().includes(search.toLowerCase()))
      .filter(p => !f.earnedMin    || p.earned >= Number(f.earnedMin))
      .filter(p => !f.opsMin       || p.ops >= Number(f.opsMin))
      .filter(p => !f.netMin       || (p.earned - p.spent) >= Number(f.netMin))
      .filter(p => !f.companiesMin || p.num_companies >= Number(f.companiesMin))
      .filter(p => !f.liqOnly      || p.liq_companies > 0)
      .sort((a, b) => {
        if (sort === 'earned')      return b.earned - a.earned;
        if (sort === 'ops')         return b.ops - a.ops;
        if (sort === 'spent')       return b.spent - a.spent;
        if (sort === 'net')         return (b.earned - b.spent) - (a.earned - a.spent);
        if (sort === 'dex_sold')    return b.dex_sold - a.dex_sold;
        if (sort === 'dex_bought')  return b.dex_bought - a.dex_bought;
        if (sort === 'companies')   return b.num_companies - a.num_companies;
        if (sort === 'liq')         return b.liq_companies - a.liq_companies;
        if (sort === 'last_active') return (b.last_active ?? 0) - (a.last_active ?? 0);
        return 0;
      });
  }, [players, search, filters, sort]);

  const setFilter = (key, val) => { setFilters(f => ({ ...f, [key]: val })); setPage(0); };
  const clearFilters = () => { setFilters(FILTER_INIT); setSearch(''); setPage(0); };

  useEffect(() => { setPage(0); }, [sort, search]);

  if (initialAddress) {
    return (
      <div className="content">
        <PlayerDetail address={initialAddress.toLowerCase()} onBack={() => router.push('/players')} />
      </div>
    );
  }

  const SortHdr = ({ col, label }) => (
    <span style={{ cursor: 'pointer', color: sort === col ? 'var(--gold)' : 'var(--text-2)', userSelect: 'none' }}
          onClick={() => setSort(col)}>
      {label}{sort === col ? ' ↓' : ''}
    </span>
  );

  const numInput = (key, placeholder) => (
    <input
      type="number"
      value={filters[key]}
      onChange={e => setFilter(key, e.target.value)}
      placeholder={placeholder}
      style={{
        width: 90, background: 'var(--bg)', border: '1px solid var(--border-2)',
        color: 'var(--text)', padding: '4px 8px', borderRadius: 4,
        fontFamily: 'var(--mono)', fontSize: 11, outline: 'none',
      }}
    />
  );

  return (
    <div className="content">

      {/* tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        <button
          className={`toggle-btn ${tab === 'search' ? 'toggle-btn--active' : ''}`}
          onClick={() => setTab('search')}
          style={{ fontSize: 11, padding: '5px 14px' }}
        >
          SEARCH
        </button>
        <button
          className={`toggle-btn ${tab === 'farmers' ? 'toggle-btn--active' : ''}`}
          onClick={() => setTab('farmers')}
          style={{ fontSize: 11, padding: '5px 14px' }}
        >
          DIRTY FARMERS
        </button>
        <button
          className="toggle-btn"
          disabled
          style={{ fontSize: 11, padding: '5px 14px', opacity: 0.3, cursor: 'not-allowed' }}
          title="Coming soon"
        >
          LEADERBOARD
        </button>
      </div>

      {tab === 'farmers' && (
        <FarmersTable farmers={farmers} loading={farmLoad} />
      )}

      {tab === 'search' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="search address…"
              style={{
                flex: '1 1 200px', minWidth: 160, background: 'var(--bg)', border: '1px solid var(--border-2)',
                color: 'var(--text)', padding: '6px 10px', borderRadius: 4,
                fontFamily: 'var(--mono)', fontSize: 11, outline: 'none',
              }}
            />
            {search && /^0x[0-9a-fA-F]{40}$/.test(search) && (
              <button className="toggle-btn toggle-btn--active" onClick={() => router.push(`/players/${search.toLowerCase()}`)}
                style={{ fontSize: 10, padding: '6px 14px' }}>
                VIEW →
              </button>
            )}
          </div>
        </div>
      )}

      {tab === 'leaderboard' && (
      <>
      {/* filter bar */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="search address…"
            style={{
              flex: '1 1 200px', minWidth: 160, background: 'var(--bg)', border: '1px solid var(--border-2)',
              color: 'var(--text)', padding: '6px 10px', borderRadius: 4,
              fontFamily: 'var(--mono)', fontSize: 11, outline: 'none',
            }}
          />
          {search && /^0x[0-9a-fA-F]{40}$/.test(search) && (
            <button className="toggle-btn toggle-btn--active" onClick={() => router.push(`/players/${search.toLowerCase()}`)}
              style={{ fontSize: 10, padding: '6px 14px' }}>
              VIEW →
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-2)' }}>
            {visible.length.toLocaleString()} / {total.toLocaleString()} players
          </span>
          {activeFilterCount > 0 && (
            <button className="toggle-btn" onClick={clearFilters} style={{ fontSize: 10, padding: '4px 10px' }}>
              ✕ CLEAR ({activeFilterCount})
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 11 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-2)' }}>
            EARNED ≥ {numInput('earnedMin', 'e.g. 10000')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-2)' }}>
            OPS ≥ {numInput('opsMin', 'e.g. 100')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-2)' }}>
            NET ≥ {numInput('netMin', 'e.g. 5000')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-2)' }}>
            CO ≥ {numInput('companiesMin', 'e.g. 1')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: filters.liqOnly ? 'var(--red)' : 'var(--text-2)' }}>
            <input type="checkbox" checked={filters.liqOnly} onChange={e => setFilter('liqOnly', e.target.checked)} />
            LIQ ONLY
          </label>
        </div>
      </div>

      {/* leaderboard table */}
      <div className="card" style={{ overflow: 'auto' }}>
        {loading && !players.length ? (
          <div className="feed-empty" style={{ padding: 40 }}>Loading players…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'JetBrains Mono' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-2)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', width: 32 }}>#</th>
                <th style={{ padding: '6px 8px' }}>ADDRESS</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="earned"      label="EARNED" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="ops"         label="OPS" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="spent"       label="COSTS" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="net"         label="NET" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="dex_sold"    label="DEX SOLD" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="dex_bought"  label="DEX BOUGHT" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}><SortHdr col="companies" label="CO" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="liq"         label="LIQ" /></th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}><SortHdr col="last_active" label="LAST ACTIVE" /></th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((p, i) => {
                const net = (p.earned ?? 0) + (p.dex_bought ?? 0) - (p.spent ?? 0) - (p.dex_sold ?? 0);
                return (
                  <tr key={p.addr} onClick={() => router.push(`/players/${p.addr}`)}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer',
                      ...(p.liq_companies > 0 ? { background: 'rgba(224,82,82,0.03)' } : {}) }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = p.liq_companies > 0 ? 'rgba(224,82,82,0.03)' : ''}>
                    <td style={{ padding: '5px 8px', color: 'var(--text-2)' }}>{page * PAGE_SIZE + i + 1}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--gold)' }}>{shortAddr(p.addr)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--green)' }}>{fmtD(p.earned)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-2)' }}>{(p.ops ?? 0).toLocaleString('en-US')}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--red)' }}>{fmtD(p.spent)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtD(net)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: '#e05252' }}>{p.dex_sold  > 0 ? fmtD(p.dex_sold)  : '—'}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: '#3ecf6a' }}>{p.dex_bought > 0 ? fmtD(p.dex_bought) : '—'}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                      {p.num_companies > 0 ? (
                        <span style={{ color: p.liq_companies > 0 ? 'var(--red)' : 'var(--text-2)' }}>
                          {p.num_companies}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: p.liq_companies > 0 ? 'var(--red)' : 'var(--text-3)' }}>
                      {p.liq_companies > 0 ? p.liq_companies : '—'}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-2)' }} suppressHydrationWarning>
                      {timeAgo(p.last_active)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {visible.length > PAGE_SIZE && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <button className="toggle-btn" onClick={() => setPage(0)} disabled={page === 0}>«</button>
            <button className="toggle-btn" onClick={() => setPage(p => p - 1)} disabled={page === 0}>‹</button>
            <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono' }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, visible.length)} of {visible.length}
            </span>
            <button className="toggle-btn" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= visible.length}>›</button>
            <button className="toggle-btn" onClick={() => setPage(Math.ceil(visible.length / PAGE_SIZE) - 1)} disabled={(page + 1) * PAGE_SIZE >= visible.length}>»</button>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
