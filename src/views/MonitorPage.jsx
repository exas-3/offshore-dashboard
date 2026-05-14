'use client';
import { useState, useRef } from 'react';
import Link from 'next/link';

function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

function fmt(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPrice(raw) {
  if (!raw || raw === '0') return '—';
  try {
    const n = Number(BigInt(raw) / 10n ** 12n) / 1e6;
    return n > 0 ? n.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—';
  } catch { return '—'; }
}

function fmtCountdown(ts) {
  if (!ts) return '—';
  const now = Math.floor(Date.now() / 1000);
  const diff = ts - now;
  if (diff <= 0) return 'ended';
  if (diff < 60)   return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

function StatusPill({ on, labelOn, labelOff, variant }) {
  const color = on
    ? (variant === 'red' ? 'status-dot--red' : 'status-dot--green')
    : 'status-dot--off';
  return <span className={`status-dot ${color}`}>{on ? labelOn : labelOff}</span>;
}

export default function MonitorPage() {
  const [input, setInput]   = useState('');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);
  const inputRef = useRef(null);

  const lookup = async (addr) => {
    const wallet = (addr ?? input).trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/i.test(wallet)) {
      setError('Enter a valid 0x address (42 chars)');
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/monitor?wallet=${wallet}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter') lookup(); };

  const s  = data?.summary;
  const ps = data?.playerStats;
  const companies = data?.companies ?? [];
  const alerts = companies.filter(c => c.active && (!c.autoTradeEnabled || c.liquidatable));

  return (
    <div className="vault-page">

      {/* search */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>WALLET MONITOR</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="0x wallet address..."
            style={{
              flex: 1,
              background: 'var(--bg)',
              border: '1px solid var(--border-2)',
              borderRadius: 4,
              padding: '8px 12px',
              color: 'var(--text)',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              outline: 'none',
            }}
            onFocus={e => { e.target.style.borderColor = 'var(--gold)'; }}
            onBlur={e  => { e.target.style.borderColor = 'var(--border-2)'; }}
          />
          <button
            onClick={() => lookup()}
            disabled={loading}
            className="toggle-btn toggle-btn--active"
            style={{ padding: '8px 20px', fontSize: 11, letterSpacing: 1 }}
          >
            {loading ? 'LOADING...' : 'LOOKUP'}
          </button>
        </div>
        {error && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 8 }}>{error}</div>}
      </div>

      {!data && !loading && (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-3)', fontSize: 12, letterSpacing: 1 }}>
          ENTER A WALLET ADDRESS TO MONITOR INFLUENCE BALANCE AND COMPANY TRADE STATES
        </div>
      )}

      {data && (
        <>
          {/* wallet header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)', letterSpacing: 1 }}>WALLET</span>
            <a
              href={`https://mega.etherscan.io/address/${data.wallet}`}
              target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--gold)', fontSize: 13, fontWeight: 600, textDecoration: 'none', letterSpacing: 1 }}
            >
              {data.wallet}
            </a>
            <Link
              href={`/players/${data.wallet}`}
              style={{ color: 'var(--text-3)', fontSize: 10, border: '1px solid var(--border-2)', padding: '2px 8px', borderRadius: 3, textDecoration: 'none' }}
            >
              PLAYER PAGE →
            </Link>
          </div>

          {/* alerts */}
          {alerts.length > 0 && (
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {alerts.filter(c => c.liquidatable).map(c => (
                <div key={c.company} style={{ background: 'rgba(224,82,82,0.08)', border: '1px solid var(--red-dim)', borderRadius: 6, padding: '8px 14px', fontSize: 11, color: 'var(--red)', display: 'flex', gap: 12 }}>
                  ⚠ LIQUIDATABLE — company <span style={{ color: 'var(--text)' }}>{c.company}</span>
                </div>
              ))}
              {alerts.filter(c => !c.autoTradeEnabled && c.active).map(c => (
                <div key={c.company} style={{ background: 'rgba(245,166,35,0.06)', border: '1px solid var(--amber-dim)', borderRadius: 6, padding: '8px 14px', fontSize: 11, color: 'var(--amber)', display: 'flex', gap: 12 }}>
                  ✕ AUTO-TRADE OFF — company <span style={{ color: 'var(--text)' }}>{c.company}</span>
                </div>
              ))}
            </div>
          )}

          {/* stat cards */}
          <div className="stats-row">
            <div className="stat-card stat-card--gold">
              <div className="stat-label">INFLUENCE BALANCE</div>
              <div className="stat-value">{fmt(data.influenceBalance)}</div>
              <div className="stat-sub">$INFLUENCE held</div>
            </div>
            <div className="stat-card stat-card--amber">
              <div className="stat-label">$DIRTY BALANCE</div>
              <div className="stat-value">{fmt(data.dirtyBalance)}</div>
              <div className="stat-sub">
                {ps ? `rank #${ps.balance > 0 ? '?' : '—'} · ${fmt(ps.earned)} earned` : 'current wallet balance'}
              </div>
            </div>
            <div className="stat-card stat-card--green">
              <div className="stat-label">COMPANIES</div>
              <div className="stat-value">{s?.total ?? 0}</div>
              <div className="stat-sub">{s?.activeCount ?? 0} active · {s?.autoTradeOn ?? 0} auto-on</div>
            </div>
            <div className={`stat-card ${s?.liquidatable > 0 ? 'stat-card--red' : 'stat-card--green'}`}>
              <div className="stat-label">STATUS</div>
              <div className="stat-value" style={{ fontSize: 18, paddingTop: 4 }}>
                {s?.liquidatable > 0 ? `${s.liquidatable} LIQ` : s?.autoTradeOff > 0 ? `${s.autoTradeOff} OFF` : 'OK'}
              </div>
              <div className="stat-sub">
                {s?.liquidatable > 0 ? 'companies at risk' : s?.autoTradeOff > 0 ? 'auto-trade disabled' : 'all systems nominal'}
              </div>
            </div>
          </div>

          {/* player stats row (from DB) */}
          {ps && (ps.earned > 0 || ps.ops > 0) && (
            <div className="card" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0 }}>
              {[
                { label: 'TOTAL EARNED', value: fmt(ps.earned), sub: '$DIRTY minted' },
                { label: 'TOTAL SPENT',  value: fmt(ps.spent),  sub: '$DIRTY spent/burned' },
                { label: 'OPERATIONS',   value: ps.ops.toLocaleString(), sub: 'all time ops' },
                { label: 'VAULT EARNED', value: fmt(ps.vault_claimed), sub: 'USDm from vault' },
                { label: 'VAULT WINS',   value: ps.vault_count.toLocaleString(), sub: 'payout events' },
              ].map((item, i) => (
                <div key={item.label} style={{
                  padding: '14px 20px',
                  borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-2)', marginBottom: 6 }}>{item.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>{item.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>{item.sub}</div>
                </div>
              ))}
            </div>
          )}

          {/* companies table */}
          <div className="card">
            <div className="chart-header" style={{ marginBottom: 12 }}>
              <span className="card-title" style={{ margin: 0 }}>
                COMPANIES
                <span style={{ color: 'var(--text-2)', fontWeight: 400, marginLeft: 8 }}>— {companies.length}</span>
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: 1 }}>LIVE FROM RPC</span>
            </div>

            {companies.length === 0 ? (
              <div className="feed-empty" style={{ height: 100 }}>No companies registered for this wallet</div>
            ) : (
              <div className="companies-table-wrap">
                <div className="companies-head">
                  <span>COMPANY</span>
                  <span>AUTO</span>
                  <span>ACTIVE</span>
                  <span>LIQ</span>
                  <span>DONE</span>
                  <span>ENDS IN</span>
                  <span>LIQ PRICE</span>
                  <span>COOLDOWN</span>
                  <span>EXPLORER</span>
                </div>
                <div className="companies-body">
                  {companies.map(c => (
                    <div
                      key={c.company}
                      className="companies-row"
                      style={c.liquidatable ? { background: 'rgba(224,82,82,0.05)' } : c.active && !c.autoTradeEnabled ? { background: 'rgba(245,166,35,0.04)' } : {}}
                    >
                      <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{shortAddr(c.company)}</span>
                      <StatusPill on={c.autoTradeEnabled} labelOn="ON" labelOff="OFF" />
                      <StatusPill on={c.active}           labelOn="YES" labelOff="NO" />
                      <StatusPill on={c.liquidatable}     labelOn="YES" labelOff="NO" variant="red" />
                      <StatusPill on={c.completable}      labelOn="YES" labelOff="NO" variant="amber" />
                      <span style={{ color: 'var(--text-2)', fontSize: 11 }}>
                        {c.active ? fmtCountdown(c.endTime) : '—'}
                      </span>
                      <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{fmtPrice(c.liqPrice)}</span>
                      <span style={{ color: 'var(--text-2)', fontSize: 11 }}>
                        {c.cooldownEnd ? fmtCountdown(c.cooldownEnd) : '—'}
                      </span>
                      <a
                        href={`https://mega.etherscan.io/address/${c.company}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--text-3)', fontSize: 11, textDecoration: 'none' }}
                      >
                        [→]
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
