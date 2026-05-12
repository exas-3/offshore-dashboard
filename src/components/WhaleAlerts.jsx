'use client';
import useWhaleAlerts from '../hooks/useWhaleAlerts';

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}..${addr.slice(-4)}` : '—';
}

function fmt(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}

export default function WhaleAlerts({ enabled, onToggle }) {
  const { toasts, dismiss } = useWhaleAlerts(enabled);

  return (
    <>
      {/* Toggle button — rendered inline by the parent in the header */}
      <button
        className={`wt-notif-btn ${enabled ? 'wt-notif-btn--on' : ''}`}
        onClick={onToggle}
        title={enabled ? 'Disable DEX alerts' : 'Enable DEX alerts (all top-200 whales)'}
      >
        {enabled ? '[DEX ALERTS ON]' : '[DEX ALERTS]'}
      </button>

      {/* Toast stack */}
      {toasts.length > 0 && (
        <div className="alert-stack">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`alert-toast alert-toast--${t.opType === 'DEX_SELL' ? 'sell' : 'buy'}`}
            >
              <span className="alert-tag">
                {t.opType === 'DEX_SELL' ? 'DEX SELL' : 'DEX BUY'}
              </span>
              <span className="alert-wallet">{shortAddr(t.wallet)}</span>
              <span className="alert-amount">{fmt(t.amount)} $DIRTY</span>
              <a
                href={`https://mega.etherscan.io/tx/${t.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="alert-link"
              >
                {'[->'}{']'}
              </a>
              <button className="alert-close" onClick={() => dismiss(t.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
