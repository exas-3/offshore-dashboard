'use client';
function timeAgo(ts) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  return `${Math.floor(d / 3600)}h`;
}

function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

const OP_META = {
  EXTORTION:  { label: 'Extortion',  cls: 'amber' },
  ARMS_DEAL:  { label: 'Arms Deal',  cls: 'blue'  },
  DRUG_DEAL:  { label: 'Drug Deal',  cls: 'green' },
  PARTIAL:    { label: 'Partial',    cls: 'dim'   },
  FAIL:       { label: 'Failed Op',  cls: 'red'   },
  BUY_ASSET:  { label: 'Buy Asset',  cls: 'gold'  },
  LEVEL_UP:   { label: 'Level Up',   cls: 'gold'  },
  BURN:       { label: 'Burn',       cls: 'red'   },
  TRANSFER:   { label: 'Transfer',   cls: 'dim'   },
};

export default function TransactionFeed({ transfers, loading }) {
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
            <span>TYPE</span>
            <span>AMOUNT</span>
            <span>FROM</span>
            <span>TO</span>
            <span>AGO</span>
            <span>TX</span>
          </div>
          <div className="feed-body">
            {transfers.length === 0 ? (
              <div className="feed-empty">No transactions found</div>
            ) : (
              transfers.map(tx => {
                const meta = OP_META[tx.opType] ?? OP_META.TRANSFER;
                return (
                  <div key={tx.hash} className={`feed-row feed-row--${meta.cls}`}>
                    <span className="feed-type">{meta.label}</span>
                    <span className="feed-amount">
                      {tx.amount > 0 ? `${tx.amount % 1 === 0 ? tx.amount : tx.amount.toFixed(2)}` : '0'}
                    </span>
                    <span className="feed-addr">{shortAddr(tx.from)}</span>
                    <span className="feed-addr">{shortAddr(tx.to)}</span>
                    <span className="feed-time">{timeAgo(tx.ts)}</span>
                    <a
                      href={`https://mega.etherscan.io/tx/${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="feed-link"
                    >
                      {'[->'}{']'}
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
