'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

function fmtUsd(n) {
  if (!n || n <= 0) return '—';
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function fmtPrice(raw) {
  if (!raw || raw === '0') return '—';
  try {
    const n = Number(BigInt(raw) / 10n ** 12n) / 1e6;
    if (n === 0) return '—';
    if (n < 0.001) return `<0.001`;
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } catch { return '—'; }
}

function liqPriceUsd(raw) {
  if (!raw || raw === '0') return null;
  try {
    const n = Number(BigInt(raw) / 10n ** 12n) / 1e6;
    return n > 0 ? n : null;
  } catch { return null; }
}

function fmtBuffer(raw, ethPrice) {
  const liq = liqPriceUsd(raw);
  if (liq === null || !ethPrice) return '—';
  const buf = ethPrice - liq;
  const ratio = buf / ethPrice;
  const pct = ratio * 100;
  const color = ratio > 0.0045 ? '#3ecf6a' : ratio > 0.001 ? '#f5a623' : '#ef4444';
  return { buf, pct, color };
}

function fmtCountdown(ts) {
  if (!ts) return '—';
  const now = Math.floor(Date.now() / 1000);
  const diff = ts - now;
  if (diff <= 0) return 'ended';
  if (diff < 60)   return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

const FILTERS = [
  { key: 'all',       label: 'All'        },
  { key: 'active',    label: 'Active'     },
  { key: 'autotrade', label: 'Auto-Trade' },
];

export default function CompaniesPage() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [page, setPage]     = useState(0);

  const load = (f = filter) => {
    fetch(`/api/companies?filter=${f}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const onFilter = (f) => {
    setFilter(f);
    setPage(0);
    load(f);
  };

  const PAGE_SIZE   = 100;
  const stats       = data?.stats;
  const companies   = data?.companies ?? [];
  const totalPages  = Math.max(1, Math.ceil(companies.length / PAGE_SIZE));
  const page0       = Math.min(page, totalPages - 1);
  const pageRows    = companies.slice(page0 * PAGE_SIZE, (page0 + 1) * PAGE_SIZE);

  return (
    <div className="vault-page">

      {/* stat cards */}
      <div className="stats-row">
        <div className="stat-card stat-card--gold">
          <div className="stat-label">TOTAL COMPANIES</div>
          <div className="stat-value">{loading ? '—' : (stats?.total ?? '—')}</div>
          <div className="stat-sub">{loading ? '' : `${stats?.uniqueOwners ?? 0} unique owners`}</div>
        </div>
        <div className="stat-card stat-card--green">
          <div className="stat-label">ACTIVE TRADES</div>
          <div className="stat-value">{loading ? '—' : (stats?.activeCount ?? '—')}</div>
          <div className="stat-sub">currently running</div>
        </div>
        <div className="stat-card stat-card--amber">
          <div className="stat-label">AUTO-TRADE ON</div>
          <div className="stat-value">{loading ? '—' : (stats?.autoTradeCount ?? '—')}</div>
          <div className="stat-sub">
            {loading || !stats ? '' : `${((stats.autoTradeCount / Math.max(stats.total, 1)) * 100).toFixed(0)}% of all`}
          </div>
        </div>
      </div>

      {/* filter + table */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="chart-header" style={{ marginBottom: 12 }}>
          <span className="card-title" style={{ margin: 0 }}>
            COMPANIES
            {companies.length > 0 && <span style={{ color: 'var(--text-2)', fontWeight: 400 }}> — {companies.length}</span>}
          </span>
          <div className="chart-toggle">
            {FILTERS.map(f => (
              <button
                key={f.key}
                className={`toggle-btn ${filter === f.key ? 'toggle-btn--active' : ''}`}
                onClick={() => onFilter(f.key)}
              >
                {f.label}
                {stats && f.key !== 'all' && (
                  <span style={{ marginLeft: 4, opacity: 0.6 }}>
                    ({
                      f.key === 'active'    ? stats.activeCount :
                      f.key === 'autotrade' ? stats.autoTradeCount : ''
                    })
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="placeholder-rows">
            {Array.from({ length: 10 }).map((_, i) => <div key={i} className="placeholder-row" />)}
          </div>
        ) : companies.length === 0 ? (
          <div className="feed-empty" style={{ height: 160 }}>
            {stats?.total === 0 ? 'No companies discovered yet — poller is syncing...' : 'No companies match this filter'}
          </div>
        ) : (
          <>
          <div className="companies-table-wrap">
            <div className="companies-head" style={{ gridTemplateColumns: '100px 100px 44px 54px 60px 80px 70px 80px 80px' }}>
              <span>COMPANY</span>
              <span>OWNER</span>
              <span>AUTO</span>
              <span>ACTIVE</span>
              <span>ENDS IN</span>
              <span>LIQ PRICE</span>
              <span>BUFFER</span>
              <span>ETH PRICE</span>
              <span>ENTRY</span>
            </div>
            <div className="companies-body">
              {pageRows.map(c => {
                const buf = fmtBuffer(c.liq_price, stats?.ethPrice);
                return (
                <div key={c.address} className="companies-row" style={{ gridTemplateColumns: '100px 100px 44px 54px 60px 80px 70px 80px 80px' }}>
                  <a
                    href={`https://mega.etherscan.io/address/${c.address}`}
                    target="_blank" rel="noopener noreferrer"
                    className="earner-addr"
                  >{shortAddr(c.address)}</a>
                  <Link href={`/players/${c.owner}`} className="earner-addr">
                    {shortAddr(c.owner)}
                  </Link>
                  <span className={`status-dot ${c.auto_trade ? 'status-dot--green' : 'status-dot--off'}`}>
                    {c.auto_trade ? 'ON' : 'OFF'}
                  </span>
                  <span className={`status-dot ${c.active ? 'status-dot--green' : 'status-dot--off'}`}>
                    {c.active ? 'YES' : 'NO'}
                  </span>
                  <span style={{ color: 'var(--text-2)', fontSize: 11 }}>
                    {c.active ? fmtCountdown(c.end_time) : '—'}
                  </span>
                  <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{fmtPrice(c.liq_price)}</span>
                  <span style={{ fontSize: 11, color: buf !== '—' ? buf.color : 'var(--text-2)' }}>
                    {buf !== '—' ? `${buf.pct.toFixed(2)}%` : '—'}
                  </span>
                  <span style={{ color: 'var(--text-2)', fontSize: 11 }}>
                    {stats?.ethPrice ? `$${stats.ethPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                  </span>
                  <span style={{ color: 'var(--text-2)', fontSize: 11 }}>{fmtUsd(c.entry_price)}</span>
                </div>
                );
              })}
            </div>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, justifyContent: 'center' }}>
              <button className="toggle-btn" onClick={() => setPage(0)}        disabled={page0 === 0}>«</button>
              <button className="toggle-btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page0 === 0}>‹</button>
              <span style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono' }}>
                {page0 + 1} / {totalPages}
              </span>
              <button className="toggle-btn" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page0 === totalPages - 1}>›</button>
              <button className="toggle-btn" onClick={() => setPage(totalPages - 1)}   disabled={page0 === totalPages - 1}>»</button>
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}
