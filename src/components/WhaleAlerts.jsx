'use client';
import { useState, useEffect } from 'react';
import useWhaleAlerts from '../hooks/useWhaleAlerts';

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}..${addr.slice(-4)}` : '—';
}

function fmt(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

const TIER_LABEL = { 1: '🐟', 2: '🐬', 3: '🐋' };

export default function WhaleAlerts() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('whaleAlertsEnabled');
    if (saved !== null) setEnabled(saved === 'true');
  }, []);

  function toggle() {
    setEnabled(v => {
      localStorage.setItem('whaleAlertsEnabled', String(!v));
      return !v;
    });
  }

  const { toasts, dismiss } = useWhaleAlerts(enabled);
  const isBuy = t => t.opType === 'DEX_BUY';

  return (
    <>
      {/* Fixed bell toggle — bottom-left */}
      <button
        onClick={toggle}
        title={enabled ? 'Disable trade alerts' : 'Enable trade alerts (≥1k DIRTY)'}
        style={{
          position: 'fixed', bottom: 24, left: 24, zIndex: 1000,
          width: 42, height: 42, borderRadius: '50%',
          background: enabled ? 'var(--green)' : 'var(--bg-2)',
          border: '1px solid var(--border-2)',
          color: enabled ? '#000' : 'var(--text-2)',
          fontSize: 18, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          transition: 'transform 0.15s, background 0.15s, color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {enabled ? '🔔' : '🔕'}
      </button>

      {/* Toast stack — top right */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed', top: 64, right: 16, zIndex: 999,
          display: 'flex', flexDirection: 'column', gap: 6,
          pointerEvents: 'none',
        }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: isBuy(t) ? 'rgba(62,207,106,0.1)' : 'rgba(224,82,82,0.1)',
              border: `1px solid ${isBuy(t) ? 'rgba(62,207,106,0.4)' : 'rgba(224,82,82,0.4)'}`,
              borderRadius: 6, padding: '7px 10px',
              fontFamily: 'var(--mono)', fontSize: 11,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              animation: 'alertSlideIn 0.2s ease',
              pointerEvents: 'all',
              minWidth: 260,
            }}>
              <span style={{ fontSize: 14 }}>{TIER_LABEL[t.tier]}</span>
              <span style={{
                color: isBuy(t) ? 'var(--green)' : 'var(--red)',
                fontWeight: 700, letterSpacing: '0.06em', minWidth: 52,
              }}>
                {isBuy(t) ? 'BUY' : 'SELL'}
              </span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                {fmt(t.amount)} $DIRTY
              </span>
              <span style={{ color: 'var(--text-2)', flex: 1 }}>{shortAddr(t.wallet)}</span>
              <a href={`https://mega.etherscan.io/tx/${t.hash}`}
                target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--text-3)', fontSize: 10 }}>↗</a>
              <button onClick={() => dismiss(t.id)}
                style={{ background: 'none', border: 'none', color: 'var(--text-3)',
                         cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes alertSlideIn {
          from { opacity: 0; transform: translateX(16px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
