'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { TerminalShell, Toasts } from './terminal.jsx';
import { InfTooltip, computeWatch, fmtK } from './trade-helpers.jsx';

function nowHMS() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}
import { LiveSidebar } from './LiveSidebar.jsx';
import { WalletRail } from './WalletRail.jsx';
import { OverviewSection } from './sections/OverviewSection.jsx';
import { TokenSection } from './sections/TokenSection.jsx';
import { PlayersSection } from './sections/PlayersSection.jsx';
import { VaultSection } from './sections/VaultSection.jsx';
import { TradesSection } from './sections/TradesSection.jsx';

// Paired grid cells resize as complements (span + partner = 12).
const CELL_PAIRS = {
  'emissions':         'burned',
  'burned':            'emissions',
  'influence-totals':  'influence-daily',
  'influence-daily':   'influence-totals',
  'trades':            'ops',
  'ops':               'trades',
  'heatmap':           'daw',
  'daw':               'heatmap',
  'supply':            'company-state',
  'company-state':     'supply',
  'circ-supply':       'dirty-price',
  'dirty-price':       'circ-supply',
  'top-stakers':       'staking-chart',
  'staking-chart':     'top-stakers',
};

const DEFAULT_SPANS = {
  'emissions':          7,
  'burned':             5,
  'supply':             7,
  'circ-supply':        6,
  'dirty-price':        6,
  'influence-totals':   4,
  'influence-daily':    8,
  'heatmap':            5,
  'daw':                4,
  'total-players':      3,
  'vault':             12,
  'top-stakers':        5,
  'trades':             6,
  'ops':                6,
  'company-state':      5,
  'staking-chart':      7,
};

const NAV = [
  { id: 'overview', label: 'overview' },
  { id: 'token',    label: 'token' },
  { id: 'players',  label: 'players' },
  { id: 'vault',    label: 'vault' },
  { id: 'trades',   label: 'trades' },
];

export function OffshoreDashboard({ D, showToasts = true, showRail = true, theme = 'purple', density = 'regular', onThemeChange }) {
  // ── Shell state ──────────────────────────────────────────────────────────
  const [activeApp, setActiveApp] = useState('offshore');
  const [search, setSearch] = useState('');
  const [notifs, setNotifs] = useState({ 'buys & sells': true, 'operations': true, 'staking': true, 'liquidations': true });
  const [walletAddr, setWalletAddr] = useState('');
  const [aliases, setAliases] = useState({});
  const openRailRef = useRef(null);

  // ── Grid layout (shared across sections) ─────────────────────────────────
  const [spans, setSpans] = useState(DEFAULT_SPANS);
  const [heights, setHeights] = useState({ supply: 360, 'influence-daily': 200 });
  function resize(id, { span, height }) {
    if (span != null) {
      const partner = CELL_PAIRS[id];
      setSpans((s) => {
        if (!partner) return { ...s, [id]: span };
        const clamped = Math.max(3, Math.min(9, span));
        return { ...s, [id]: clamped, [partner]: 12 - clamped };
      });
    }
    if (height != null) setHeights((h) => ({ ...h, [id]: height }));
  }
  const grid = { spans, heights, resize };

  function openWallet(fullAddr) {
    setWalletAddr(fullAddr);
    if (openRailRef.current) openRailRef.current();
  }

  // ── Aliases (every 2 min) ────────────────────────────────────────────────
  useEffect(() => {
    const load = () => fetch('/api/aliases').then(r => r.json()).then(setAliases).catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);

  // ── Live counters + ops feed ─────────────────────────────────────────────
  const ci = D.counterInit || {};
  const [counters, setCounters] = useState(() => ({
    block:     ci.block   || 4128907,
    daw:       ci.daw     || 930,
    opsMin:    ci.opsMin  || 4.2,
    dirty:     ci.dirty   || 0.0706,
    opCost:    ci.opCost  || 12.41,
    gas:       ci.gas     || 0.001,
    eth:       D.liveTrades[0]?.ethPrice ?? 0,
    activeOps: D.activeCompanies ?? 0,
    tps:       0,
    _bump:     0,
    _lastOkAt: Date.now(),  // last successful live-tick — used to decide if RPC is "live"
  }));
  const [ops, setOps] = useState(() =>
    (D.recentOps && D.recentOps.length > 0)
      ? D.recentOps.slice(0, 250).map(o => ({ ...o, time: nowHMS() }))
      : []
  );
  const [liveTrades, setLiveTrades] = useState(() => D.liveTrades || []);
  const [watchRaw, setWatchRaw] = useState(() => D.liveTrades || []);
  const [liveTicker, setLiveTicker] = useState(() => D.liveTradeTicker || []);
  const [latestNewOps, setLatestNewOps] = useState([]);
  const [recentStarts, setRecentStarts] = useState(() => D.recentStarts || []);

  const lastOpTsRef  = useRef(
    (D.recentOps && D.recentOps.length > 0) ? (D.recentOps[0]._ts || 0) : 0
  );
  const lastLiqTsRef = useRef(0);

  // ETH price (3s)
  useEffect(() => {
    const update = () =>
      fetch('/api/eth-price', { cache: 'no-cache' })
        .then(r => r.json())
        .then(({ price }) => { if (isFinite(price) && price > 0) setCounters(c => ({ ...c, eth: price })); })
        .catch(() => {});
    update();
    const t = setInterval(update, 3_000);
    return () => clearInterval(t);
  }, []);

  // Live tick (800ms): counters, new ops, live trades, ticker events
  useEffect(() => {
    let live = true;
    let inflight = false;  // skip overlapping ticks when RPC is slow
    let lastEventTs = (D.liveTradeTicker && D.liveTradeTicker[0]?._ts) || 0;
    const tick = async () => {
      if (!live || inflight) return;
      inflight = true;
      try {
        const res = await fetch(`/api/offshore-data/live?since=${lastOpTsRef.current}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error('non-ok');
        const d = await res.json();
        setCounters((c) => ({
          ...c,
          block:  d.block  ?? (c.block  + 1 + Math.floor(Math.random() * 3)),
          daw:    d.daw    ?? c.daw,
          opsMin: d.opsMin ?? Math.max(0, c.opsMin + (Math.random() - 0.5) * 0.6),
          dirty:  d.dirty  ?? Math.max(0.001, c.dirty + (Math.random() - 0.5) * 0.0008),
          opCost: d.opCost ?? Math.max(0, c.opCost + (Math.random() - 0.5) * 0.04),
          gas:    d.gas    ?? Math.max(0, c.gas    + (Math.random() - 0.5) * 0.0002),
          eth:       c.eth,
          activeOps: d.activeOps ?? c.activeOps,
          tps:       d.tps       ?? c.tps,
          _bump:  c._bump + 1,
          _lastOkAt: Date.now(),
        }));
        if (d.newOps && d.newOps.length > 0) {
          const ts = nowHMS();
          lastOpTsRef.current = d.newOps[d.newOps.length - 1]._ts;
          setOps((prev) => {
            // Dedupe against existing — overlapping polls can return the same row twice.
            // Key: hash + walletFull + op (matches server-side dedup); fall back to wallet+op+_ts.
            const seen = new Set(prev.map(o => `${o.hash || ''}:${o.walletFull || o.wallet}:${o.op}:${o._ts || ''}`));
            const incoming = d.newOps
              .filter(o => !seen.has(`${o.hash || ''}:${o.walletFull || o.wallet}:${o.op}:${o._ts || ''}`))
              .map(o => ({ ...o, time: ts }))
              .reverse();
            return [...incoming, ...prev].slice(0, 250);
          });
          setLatestNewOps(d.newOps);
        }
        if (d.liveTrades && d.liveTrades.length > 0) {
          setWatchRaw(d.liveTrades);
          setLiveTrades(d.liveTrades);
        }
        if (d.recentStarts) setRecentStarts(d.recentStarts);
        if (d.latestEvent && d.latestEvent._ts > lastEventTs) {
          lastEventTs = d.latestEvent._ts;
          setLiveTicker((prev) => {
            // Dedupe by tx hash to handle multi-hop swaps that emit two events
            // for the same tx, or repeated polls hitting the same event.
            const ev = d.latestEvent;
            if (ev.hash && prev.some(p => p.hash === ev.hash && p.kind === ev.kind)) return prev;
            return [ev, ...prev].slice(0, 60);
          });
        }
        if (d.newLiqs && d.newLiqs.length > 0) {
          const fresh = d.newLiqs.filter(l => l._ts > lastLiqTsRef.current);
          if (fresh.length > 0) lastLiqTsRef.current = fresh[fresh.length - 1]._ts;
        }
      } catch {
        setCounters((c) => ({
          ...c,
          block:  c.block  + 1 + Math.floor(Math.random() * 3),
          opsMin: Math.max(0, c.opsMin + (Math.random() - 0.5) * 0.6),
          dirty:  Math.max(0.001, c.dirty + (Math.random() - 0.5) * 0.0008),
          opCost: Math.max(0, c.opCost + (Math.random() - 0.5) * 0.04),
          gas:    Math.max(0, c.gas    + (Math.random() - 0.5) * 0.0002),
          _bump:  c._bump + 1,
        }));
      } finally {
        inflight = false;
      }
    };
    const t = setInterval(tick, 800);
    return () => { live = false; clearInterval(t); };
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  const watch = useMemo(() => computeWatch(watchRaw, counters.eth), [watchRaw, counters.eth]);

  const filteredTicker = useMemo(() => liveTicker.filter(item => {
    if ((item.kind === 'buy' || item.kind === 'sell') && !notifs['buys & sells']) return false;
    if (item.kind === 'op'          && !notifs['operations'])   return false;
    if (item.kind === 'stake'       && !notifs['staking'])      return false;
    if (item.kind === 'liquidation' && !notifs['liquidations']) return false;
    return true;
  }), [liveTicker, notifs]);

  const inf = D.influenceFlow.totals;
  const dawPct = D.dailyActiveWalletsPeak > 0
    ? Math.round((1 - counters.daw / D.dailyActiveWalletsPeak) * 100)
    : 0;

  // ── Header ticker / footer ───────────────────────────────────────────────
  const base = D.priceBase25h || {};
  const pct = (current, baseline) => (!baseline || !current) ? null : ((current - baseline) / baseline) * 100;
  const latestMc = D.marketCapChart?.at(-1)?.v ?? 0;
  const ticker = [
    { k: '$DIRTY',  v: `$${counters.dirty.toFixed(4)}`,     trend: pct(counters.dirty,  base.dirty) },
    { k: 'OP COST', v: `${counters.opCost.toFixed(2)} INF`, trend: pct(counters.opCost, base.infCost), tooltip: <InfTooltip data={D.infCostHistory || []} current={counters.opCost} trend={pct(counters.opCost, base.infCost)} /> },
    { k: 'ETH',     v: `$${counters.eth.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, trend: pct(counters.eth, base.eth) },
    { k: 'SUPPLY',  v: fmtK(D.hero.supply) },
    { k: 'MC',      v: `$${fmtK(latestMc)}` },
  ];

  // 5s grace before we flip to "down" so brief blips don't flicker the indicator.
  const rpcLive = Date.now() - (counters._lastOkAt ?? 0) < 5000;
  const sideFoot = [
    { k: 'rpc',   v: rpcLive ? 'live' : 'down', cls: rpcLive ? 'pos' : 'neg' },
    { k: 'block', v: counters.block.toLocaleString() },
  ];

  const rail = showRail ? (
    <WalletRail address={walletAddr} onAddressChange={setWalletAddr} ethPrice={counters.eth} newOps={latestNewOps} />
  ) : null;

  return (
    <TerminalShell
      mode="standalone"
      brand={{ name: 'OFFSHORE', sub: 'community dashboard · v0.6.0-beta' }}
      nav={NAV}
      apps={D.apps}
      activeAppId={activeApp}
      onAppChange={setActiveApp}
      ticker={ticker}
      search={search}
      onSearch={setSearch}
      sideFooter={sideFoot}
      rail={rail}
      sideContent={<LiveSidebar D={D} counters={counters} ops={ops} watch={watch} trades={liveTicker} recentStarts={recentStarts} onWallet={openWallet} aliases={aliases} />}
      railLabel="criminal"
      theme={theme}
      onThemeChange={onThemeChange}
      notifPrefs={notifs}
      onNotifChange={setNotifs}
      openRailRef={openRailRef}
      density={density}
    >
      <div className="tm-content">
        <OverviewSection D={D} counters={counters} infPurchased={inf.purchased} dawPct={dawPct} />
        <TokenSection    D={D} grid={grid} />
        <PlayersSection  D={D} grid={grid} />
        <VaultSection    D={D} grid={grid} aliases={aliases} onWallet={openWallet} />
        <TradesSection   grid={grid} liveTrades={liveTrades} ops={ops} search={search} ethPrice={counters.eth} aliases={aliases} onWallet={openWallet} />
      </div>

      {showToasts && <Toasts items={filteredTicker} />}
    </TerminalShell>
  );
}
