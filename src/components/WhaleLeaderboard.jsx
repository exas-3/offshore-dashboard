'use client';
const OP_LABEL = {
  EXTORTION: 'Extortion',
  ARMS_DEAL: 'Arms Deal',
  DRUG_DEAL: 'Drug Deal',
  PARTIAL:   'Partial',
};

function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

function timeAgo(ts) {
  if (!ts) return '—';
  const d = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (d < 60)   return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function fmt(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function PctBar({ pct, isContract }) {
  const capped = Math.min(pct, 100);
  return (
    <div className="pct-bar-wrap" title={`${pct.toFixed(2)}%`}>
      <div className="pct-bar-inner">
        <div
          className={`pct-bar ${isContract ? 'pct-bar--contract' : ''}`}
          style={{ width: `${capped}%` }}
        />
      </div>
      <span className="pct-bar-label">{pct.toFixed(1)}%</span>
    </div>
  );
}

export default function WhaleLeaderboard({ whales, supply, loading, knownContracts = {} }) {
  if (loading) {
    return (
      <div className="card whale-card">
        <div className="card-title">WHALE LEADERBOARD — TOP HOLDERS</div>
        <div className="placeholder-rows">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="placeholder-row" />)}
        </div>
      </div>
    );
  }

  if (!whales?.length) {
    return (
      <div className="card whale-card">
        <div className="card-title">WHALE LEADERBOARD — TOP HOLDERS</div>
        <div className="feed-empty">Holders not yet synced — check back in a moment</div>
      </div>
    );
  }

  return (
    <div className="card whale-card">
      <div className="card-title">
        WHALE LEADERBOARD — TOP HOLDERS
        <span className="card-title-sub">
          {whales.length} shown · protocol contracts excluded
        </span>
      </div>

      <div className="whale-table-wrap">
        <div className="whale-head">
          <span>#</span>
          <span>ADDRESS</span>
          <span>BALANCE</span>
          <span>% SUPPLY</span>
          <span>OPS 24H</span>
          <span>TOTAL OPS</span>
          <span>TOTAL MINTED</span>
          <span>TOTAL SPENT</span>
          <span>FAV OP</span>
          <span>LAST ACTIVE</span>
          <span></span>
        </div>

        <div className="whale-body">
          {whales.map(w => {
            const pct = supply ? (w.balance / supply) * 100 : 0;
            return (
              <div key={w.address} className={`whale-row ${w.isContract ? 'whale-row--contract' : ''}`}>
                <span className="whale-rank">{w.rank}</span>

                <span className="whale-addr">
                  {knownContracts[w.address]
                    ? <span className="contract-badge lp-badge">[LP]</span>
                    : w.isContract
                      ? <span className="contract-badge">[C]</span>
                      : null}
                  {shortAddr(w.address)}
                </span>

                <span className="whale-balance">{fmt(w.balance)}</span>

                <span className="whale-pct">
                  <PctBar pct={pct} isContract={w.isContract} />
                </span>

                <span className={`whale-ops24h ${w.ops24h > 0 ? 'whale-ops24h--active' : ''}`}>
                  {w.ops24h > 0 ? `+${w.ops24h}` : '—'}
                </span>

                <span className="whale-total-ops">{fmt(w.totalOps)}</span>

                <span className="whale-minted">{fmt(w.totalMinted)}</span>

                <span className="whale-spent">{w.totalSpent > 0 ? fmt(w.totalSpent) : '—'}</span>

                <span className={`whale-fav op-${(w.favOp ?? '').toLowerCase()}`}>
                  {OP_LABEL[w.favOp] ?? '—'}
                </span>

                <span className="whale-last" suppressHydrationWarning>{timeAgo(w.lastActive)}</span>

                <a
                  href={`https://mega.etherscan.io/address/${w.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="feed-link"
                >
                  {'[->'}{']'}
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
