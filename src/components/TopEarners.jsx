'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';



function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

function fmt(n) {
  if (n == null) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

export default function TopEarners({ earners, loading, onRefresh }) {
  const router = useRouter();
  const max = earners[0]?.total ?? 1;
  const [reconcile, setReconcile] = useState({ running: false, done: 0, total: 0, error: null });

  const pollStatus = useCallback(async () => {
    const r = await fetch(`${API}/api/admin/reconcile/status`);
    const s = await r.json();
    setReconcile(s);
    if (s.running) setTimeout(pollStatus, 2000);
    else if (s.done > 0 && onRefresh) onRefresh();
  }, [onRefresh]);

  const startReconcile = async () => {
    const r = await fetch(`${API}/api/admin/reconcile`, { method: 'POST' });
    const s = await r.json();
    if (s.ok) {
      setReconcile({ running: true, done: 0, total: 0, error: null });
      setTimeout(pollStatus, 2000);
    }
  };

  const pct = reconcile.total > 0 ? Math.round((reconcile.done / reconcile.total) * 100) : 0;

  return (
    <div className="card earners-card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>
          TOP EARNERS — $DIRTY MINTED (ALL TIME)
          {!loading && earners.length > 0 && (
            <span className="card-title-sub">{earners.length} wallets</span>
          )}
        </span>
      </div>

      {reconcile.running && (
        <div style={{ height: 3, background: 'var(--border)', marginBottom: 8, borderRadius: 2 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--green)', borderRadius: 2, transition: 'width 0.4s' }} />
        </div>
      )}

      {loading ? (
        <div className="placeholder-rows">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="placeholder-row" />
          ))}
        </div>
      ) : earners.length === 0 ? (
        <div className="feed-empty">No data yet</div>
      ) : (
        <div className="earners-table-wrap">
          <div className="earners-head">
            <span>#</span>
            <span>ADDRESS</span>
            <span>$DIRTY MINTED</span>
            <span>OPS</span>
            <span></span>
          </div>
          <div className="earners-body">
            {earners.map((e, i) => (
              <div key={e.addr} className="earners-row">
                <span className="earner-rank">#{i + 1}</span>
                <span
                  className="earner-addr"
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/players/${e.addr}`)}
                >
                  {shortAddr(e.addr)}
                </span>
                <span className="earner-total">{fmt(e.total)}</span>
                <span className="earner-ops">{e.ops.toLocaleString()}</span>
                <div className="earner-bar-wrap">
                  <div
                    className="earner-bar"
                    style={{ width: `${(e.total / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
