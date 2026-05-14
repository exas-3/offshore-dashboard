'use client';
import { useRouter } from 'next/navigation';

const LP   = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';
const ZERO = '0x0000000000000000000000000000000000000000';

function timeAgo(ts) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  return `${Math.floor(d / 3600)}h`;
}

function shortAddr(addr) {
  if (!addr || addr === ZERO) return '—';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

// Derive a canonical operation from the raw fields.
// Returns { label, cls, player } where player is the actor address.
function classify(tx) {
  const from = (tx.from ?? '').toLowerCase();
  const to   = (tx.to   ?? '').toLowerCase();

  // ── Earned (MINT) ────────────────────────────────────────────────────────
  if (tx.kind === 'MINT') {
    const player = to;
    if (tx.opType === 'DRUG_DEAL')  return { label: 'Completed Operation', cls: 'green', player };
    if (tx.opType === 'ARMS_DEAL')  return { label: 'Completed Operation', cls: 'green', player };
    if (tx.opType === 'EXTORTION')  return { label: 'Completed Operation', cls: 'green', player };
    if (tx.opType === 'PARTIAL')    return { label: 'Partial',             cls: 'dim',   player };
    if (tx.opType === 'FAIL')       return { label: 'Failed Operation',    cls: 'red',   player };
    if (tx.opType === 'SCRAP') return { label: 'Scrap Item',      cls: 'dim',    player };
    return                                 { label: 'Mint',            cls: 'green',  player };
  }

  // ── Spent / Burned (SPEND | BURN) ────────────────────────────────────────
  if (tx.kind === 'SPEND' || tx.kind === 'BURN') {
    const player = from;
    if (tx.opType === 'LEVEL_UP')         return { label: 'Level Up',        cls: 'gold',  player };
    if (tx.opType === 'BUY_ASSET')        return { label: 'Buy Asset',        cls: 'gold',  player };
    if (tx.opType === 'THIRD_ENTERPRISE') return { label: '3rd Enterprise',   cls: 'purple', player };
    if (tx.opType === 'BURN')             return { label: 'Protocol Burn',    cls: 'red',   player };
    return                                       { label: 'Spend',            cls: 'dim',   player };
  }

  // ── Transfers (DEX or wallet-to-wallet) ──────────────────────────────────
  if (to   === LP) return { label: 'DEX Sell', cls: 'red',   player: from };
  if (from === LP) return { label: 'DEX Buy',  cls: 'green', player: to   };
  return                  { label: 'Transfer', cls: 'dim',   player: from };
}

const CLS_COLOR = {
  green:  'var(--green)',
  blue:   '#4a9fd8',
  amber:  'var(--amber)',
  gold:   'var(--gold)',
  red:    'var(--red)',
  purple: '#c084fc',
  dim:    'var(--text-2)',
};

export default function TransactionFeed({ transfers, loading }) {
  const router = useRouter();
  return (
    <div className="card feed-card">
      <div className="card-title">
        LIVE OPERATIONS FEED
        {!loading && <span className="card-title-sub">{transfers.length} recent txs</span>}
      </div>

      {loading ? (
        <div className="placeholder-rows">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="placeholder-row" />
          ))}
        </div>
      ) : (
        <div className="feed-table">
          <div className="feed-head">
            <span>OPERATION</span>
            <span>AMOUNT</span>
            <span>PLAYER</span>
            <span>AGO</span>
            <span>TX</span>
          </div>
          <div className="feed-body">
            {transfers.length === 0 ? (
              <div className="feed-empty">No transactions found</div>
            ) : (
              transfers.map(tx => {
                const { label, cls, player } = classify(tx);
                const color = CLS_COLOR[cls] ?? 'var(--text-2)';
                return (
                  <div key={`${tx.hash}-${tx.log_index}`}
                    className="feed-row"
                   >
                    <span className="feed-type" style={{ color }}>{label}</span>
                    <span className="feed-amount" style={{ color: tx.kind === 'MINT' ? 'var(--green)' : tx.kind === 'SPEND' || tx.kind === 'BURN' ? 'var(--red)' : 'var(--text-2)' }}>
                      {tx.amount > 0
                        ? (tx.amount % 1 === 0 ? tx.amount.toLocaleString() : tx.amount.toFixed(2))
                        : '0'}
                    </span>
                    <span className="feed-addr" style={{ color: 'var(--gold)', cursor: player && player !== ZERO ? 'pointer' : 'default' }}
                      onClick={() => player && player !== ZERO && router.push(`/players/${player}`)}>
                      {shortAddr(player)}
                    </span>
                    <span className="feed-time" suppressHydrationWarning>{timeAgo(tx.ts)}</span>
                    <a href={`https://mega.etherscan.io/tx/${tx.hash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="feed-link">
                      {'[→]'}
                    </a>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
