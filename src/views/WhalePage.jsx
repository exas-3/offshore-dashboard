'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import FarmersTable from '../components/FarmersTable';

const REFRESH_MS = 15_000;
const STORAGE_KEY = 'offshore-tracked-whales';

const OP_META = {
  EXTORTION:  { label: 'Extortion',  cls: 'amber'  },
  ARMS_DEAL:  { label: 'Arms Deal',  cls: 'blue'   },
  DRUG_DEAL:  { label: 'Drug Deal',  cls: 'green'  },
  PARTIAL:    { label: 'Partial',    cls: 'dim'    },
  BUY_ASSET:  { label: 'Buy Asset',  cls: 'gold'   },
  LEVEL_UP:   { label: 'Level Up',   cls: 'gold'   },
  BURN:       { label: 'Burn',       cls: 'red'    },
  DEX_SELL:   { label: 'DEX Sell',   cls: 'red'    },
  DEX_BUY:    { label: 'DEX Buy',    cls: 'green'  },
};

function shortAddr(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}..${addr.slice(-4)}`;
}

function timeAgo(ts) {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (d < 60)   return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

function loadSelected() {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')); }
  catch { return new Set(); }
}

function saveSelected(set) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

function fmtK(n) {
  if (!n) return null;
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
}

export default function WhalePage({ whales, dexSummary = {}, whaleLoading }) {
  const [tab, setTab]             = useState('tracker');
  const [farmers, setFarmers]     = useState([]);
  const [farmLoad, setFarmLoad]   = useState(false);
  const [selected, setSelected]   = useState(() => new Set());
  const [activity, setActivity]   = useState([]);
  const [notifOn, setNotifOn]     = useState(false);
  const [notifState, setNotifState] = useState(() => (typeof window !== 'undefined' ? Notification.permission : 'default'));
  const [filter, setFilter]       = useState('ALL'); // ALL | MINT | SPEND | BURN
  const lastCheckTs               = useRef(Math.floor(Date.now() / 1000));
  const [actLoading, setActLoading] = useState(false);

  const loadFarmers = useCallback(async () => {
    setFarmLoad(true);
    try {
      const d = await fetch('/api/farmers?limit=200').then(r => r.json());
      setFarmers(Array.isArray(d) ? d : []);
    } finally {
      setFarmLoad(false);
    }
  }, []);

  useEffect(() => { if (tab === 'farmers' && farmers.length === 0) loadFarmers(); }, [tab, farmers.length, loadFarmers]);

  const toggle = useCallback((addr) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(addr) ? next.delete(addr) : next.add(addr);
      saveSelected(next);
      return next;
    });
  }, []);

  const selectAll  = () => { const s = new Set(whales.map(w => w.address)); saveSelected(s); setSelected(s); };
  const selectNone = () => { saveSelected(new Set()); setSelected(new Set()); };

  const requestNotif = async () => {
    if (notifState === 'denied') return;
    if (typeof window === 'undefined') return;
    const result = await Notification.requestPermission();
    setNotifState(result);
    if (result === 'granted') setNotifOn(true);
  };

  const toggleNotif = () => {
    if (!notifOn && notifState !== 'granted') { requestNotif(); return; }
    setNotifOn(v => !v);
  };

  const fetchActivity = useCallback(async () => {
    if (selected.size === 0) { setActivity([]); return; }
    setActLoading(true);
    try {
      const addrs = [...selected].join(',');
      const res = await fetch(`/api/whale-activity?addresses=${addrs}&limit=500`);
      const { activity: rows } = await res.json();

      // Fire notifications for anything newer than last check
      const newItems = rows.filter(r => r.ts > lastCheckTs.current);
      if (notifOn && newItems.length > 0 && typeof window !== 'undefined' && Notification.permission === 'granted') {
        newItems.slice(0, 5).forEach(item => {
          const meta = OP_META[item.opType] ?? { label: item.opType };
          new Notification(`Whale move — ${shortAddr(item.wallet)}`, {
            body: `${meta.label}  ${item.amount > 0 ? item.amount.toFixed(0) + ' $DIRTY' : ''}`,
            tag:  item.hash,
          });
        });
      }
      lastCheckTs.current = Math.floor(Date.now() / 1000);
      setActivity(rows);
    } catch { /* silent */ } finally {
      setActLoading(false);
    }
  }, [selected, notifOn]);

  useEffect(() => { setSelected(loadSelected()); }, []);

  useEffect(() => {
    fetchActivity();
    const t = setInterval(fetchActivity, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchActivity]);

  const filtered = filter === 'ALL'  ? activity
                 : filter === 'SWAP' ? activity.filter(a => a.kind === 'SWAP')
                 : activity.filter(a => a.kind === filter);

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
        <button className={`toggle-btn ${tab === 'tracker' ? 'toggle-btn--active' : ''}`}
          onClick={() => setTab('tracker')} style={{ fontSize: 11, padding: '5px 14px' }}>
          TRACKER
        </button>
        <button className={`toggle-btn ${tab === 'farmers' ? 'toggle-btn--active' : ''}`}
          onClick={() => setTab('farmers')} style={{ fontSize: 11, padding: '5px 14px' }}>
          DIRTY FARMERS
        </button>
      </div>

    {tab === 'farmers' && <FarmersTable farmers={farmers} loading={farmLoad} />}

    {tab === 'tracker' && <div className="whale-page">
      {/* ── left: wallet list ── */}
      <div className="wt-sidebar">
        <div className="wt-sidebar-header">
          <span className="wt-section-label">TRACKED WALLETS</span>
          <div className="wt-sidebar-actions">
            <button className="wt-btn" onClick={selectAll}>All</button>
            <button className="wt-btn" onClick={selectNone}>None</button>
          </div>
        </div>

        <div className="wt-wallet-list">
          {whaleLoading ? (
            <div className="placeholder-rows">
              {Array.from({length: 8}).map((_, i) => <div key={i} className="placeholder-row" />)}
            </div>
          ) : whales.map(w => {
            const dex = dexSummary[w.address];
            return (
              <label key={w.address} className={`wt-wallet-row ${selected.has(w.address) ? 'wt-wallet-row--on' : ''}`}>
                <input
                  type="checkbox"
                  className="wt-check"
                  checked={selected.has(w.address)}
                  onChange={() => toggle(w.address)}
                />
                <span className="wt-wallet-rank">#{w.rank}</span>
                <span className="wt-wallet-addr">{shortAddr(w.address)}</span>
                <span className="wt-wallet-bal">
                  {w.balance >= 1000
                    ? `${(w.balance / 1000).toFixed(0)}k`
                    : w.balance.toFixed(0)}
                </span>
                {dex && (
                  <span className="wt-dex-badges">
                    {dex.sells > 0 && <span className="wt-dex-sell">{dex.sells}S</span>}
                    {dex.buys  > 0 && <span className="wt-dex-buy">{dex.buys}B</span>}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* ── right: activity feed ── */}
      <div className="wt-feed-panel">
        <div className="wt-feed-header">
          <span className="wt-section-label">
            ACTIVITY FEED
            <span className="wt-selected-count">{selected.size} tracked</span>
          </span>

          <div className="wt-feed-controls">
            {/* type filter */}
            <div className="chart-toggle">
              {['ALL','MINT','SPEND','BURN','SWAP'].map(k => (
                <button
                  key={k}
                  className={`toggle-btn ${filter === k ? 'toggle-btn--active' : ''}`}
                  onClick={() => setFilter(k)}
                >
                  {k}
                </button>
              ))}
            </div>

            {/* notification toggle */}
            <button
              className={`wt-notif-btn ${notifOn ? 'wt-notif-btn--on' : ''} ${notifState === 'denied' ? 'wt-notif-btn--denied' : ''}`}
              onClick={toggleNotif}
              title={notifState === 'denied' ? 'Notifications blocked in browser' : notifOn ? 'Disable notifications' : 'Enable notifications'}
            >
              {notifOn ? '[NOTIF ON]' : '[NOTIF OFF]'}
            </button>
          </div>
        </div>

        {selected.size === 0 ? (
          <div className="wt-empty">Select wallets on the left to start tracking</div>
        ) : actLoading && filtered.length === 0 ? (
          <div className="placeholder-rows" style={{ padding: '12px 0' }}>
            {Array.from({length: 6}).map((_, i) => <div key={i} className="placeholder-row" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="wt-empty">No activity found for selected wallets</div>
        ) : (
          <div className="wt-activity-table">
            <div className="wt-act-head">
              <span>WALLET</span>
              <span>TYPE</span>
              <span>AMOUNT</span>
              <span>DIRECTION</span>
              <span>WHEN</span>
              <span>TX</span>
            </div>
            <div className="wt-act-body">
              {filtered.map(row => {
                const meta = OP_META[row.opType] ?? { label: row.opType, cls: 'dim' };
                const isSend = row.from === row.wallet;
                return (
                  <div key={`${row.hash}-${row.log_index}`} className={`wt-act-row wt-act-row--${meta.cls} ${row.kind === 'SWAP' ? 'wt-act-row--swap' : ''}`}>
                    <span className="wt-act-wallet">{shortAddr(row.wallet)}</span>
                    <span className="wt-act-type">{meta.label}</span>
                    <span className="wt-act-amount">
                      {row.amount > 0 ? `${row.amount.toFixed(0)} $DIRTY` : '—'}
                    </span>
                    <span className={`wt-act-dir ${isSend ? 'wt-act-dir--out' : 'wt-act-dir--in'}`}>
                      {row.kind === 'MINT' ? 'earned'
                       : row.opType === 'DEX_SELL' ? 'sold'
                       : row.opType === 'DEX_BUY'  ? 'bought'
                       : isSend ? 'spent' : 'received'}
                    </span>
                    <span className="wt-act-time" suppressHydrationWarning>{timeAgo(row.ts)}</span>
                    <a
                      href={`https://mega.etherscan.io/tx/${row.hash}`}
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
        )}
      </div>
    </div>}
    </div>
  );
}
