'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { TerminalShell, Toasts } from './terminal.jsx';
import { InfTooltip, computeWatch, fmtK } from './trade-helpers.jsx';

function nowHMS() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

const shortAddr = (a) => a ? a.slice(0, 6) + '…' + a.slice(-3) : '';

// Smooth-scroll the dashboard so the band's section comes into view at the
// top. .tm-main-scroll is position: relative so the band's offsetTop is the
// natural offset within the scroll container. Pass `stickyTop` matching the
// band's `top:` value so the target lands at the right pinned-stack offset.
// If the user is already at-or-past that point (band currently sticky-
// pinned), the click is a no-op — no surprise jumps.
function scrollBandToTop(band, stickyTop = 0) {
  if (!band) return;
  const scrollEl = band.closest('.tm-main-scroll')
    || document.querySelector('.tm-main-scroll');
  if (!scrollEl) {
    band.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const target = band.offsetTop - stickyTop;
  // If currentScrollTop ≈ target, the browser's scrollTo with behavior:'smooth'
  // is a natural no-op (delta = 0) — that handles the "protocol exactly
  // under criminal" case without us short-circuiting.
  scrollEl.scrollTo({ top: target, behavior: 'smooth' });
}

function relAgo(ts) {
  const diff = Math.floor(Date.now() / 1000) - Number(ts);
  if (!ts || !isFinite(diff) || diff < 0) return null;
  if (diff < 60)    return `${diff}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}
import { LiveSidebar } from './LiveSidebar.jsx';
import { TokenSection } from './sections/TokenSection.jsx';
import { PlayersSection } from './sections/PlayersSection.jsx';
import { VaultSection } from './sections/VaultSection.jsx';
import { TradesSection } from './sections/TradesSection.jsx';
import { HitsSection } from './sections/HitsSection.jsx';
import { FeedbackTerminal } from './FeedbackTerminal.jsx';
import { CriminalChartSection } from './sections/CriminalChartSection.jsx';
import { WalletInspectorSection } from './sections/WalletInspectorSection.jsx';
import { StakingSection } from './sections/StakingSection.jsx';

// Paired grid cells resize as complements (span + partner = 12).
const CELL_PAIRS = {
  'emissions':         'burned',
  'burned':            'emissions',
  'influence-totals':  'influence-daily',
  'influence-daily':   'influence-totals',
  'trades':            'ops',
  'ops':               'trades',
  'hits-table':        'hits-chart',
  'hits-chart':        'hits-table',
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
  'watch-chart':        9,
  'watch-companies':    3,
  'indexed-stats':      4,
  'recent-activity':    4,
  'farmed-daily':       4,
  'trades':             6,
  'ops':                6,
  'company-state':      5,
  'staking-chart':      7,
  'hits-table':         7,
  'hits-chart':         5,
};

const NAV = [
  { id: 'overview', label: 'overview' },
  { id: 'token',    label: 'token' },
  { id: 'players',  label: 'players' },
  { id: 'vault',    label: 'vault' },
  { id: 'watch',    label: 'watch' },
  { id: 'trades',   label: 'trades' },
];

export function OffshoreDashboard({ D: initialD, showToasts = true, showRail = true, theme = 'amber', density = 'regular', onThemeChange, initialAddress = '' }) {
  // Mirror the initial server payload into state, then refresh it from
  // /api/offshore-data every 60 s so aggregate stats (hero, charts,
  // influence totals, leaderboard, etc.) don't drift on long sessions.
  // The 800 ms live tick already handles counters / ops / trades /
  // companiesStats — this is the slower backstop for everything else.
  const [D, setD] = useState(initialD);
  useEffect(() => {
    let live = true;
    const refresh = () => fetch('/api/offshore-data')
      .then(r => r.json())
      .then(d => { if (live && d && !d.error) setD(d); })
      .catch(() => {});
    const t = setInterval(refresh, 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  // ── Shell state ──────────────────────────────────────────────────────────
  const [activeApp, setActiveApp] = useState('offshore');
  const [search, setSearch] = useState('');
  const [notifs, setNotifs] = useState({ 'buys & sells': true, 'operations': true, 'staking': true, 'liquidations': true });
  // Seed walletAddr from the URL (when arriving via /criminal/0x…). The
  // inspector section below the criminal-watch chart renders automatically
  // when walletAddr matches a full 0x address.
  const [walletAddr, setWalletAddr] = useState(initialAddress);
  // sessionWallet persists across URL changes / reloads (localStorage). It
  // drives the always-visible CRIMINAL band even when the user is on /.
  // walletAddr keeps driving the criminal-zone content (only on /criminal/).
  const [sessionWallet, setSessionWallet] = useState(() => {
    if (initialAddress && /^0x[0-9a-fA-F]{40}$/.test(initialAddress)) return initialAddress.toLowerCase();
    if (typeof window === 'undefined') return '';
    try { return localStorage.getItem('offshore.lastWallet') || ''; } catch { return ''; }
  });
  // Whenever the URL gives us a valid address, remember it as sessionWallet.
  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddr)) return;
    const lc = walletAddr.toLowerCase();
    setSessionWallet(lc);
    try { localStorage.setItem('offshore.lastWallet', lc); } catch {}
  }, [walletAddr]);
  const [aliases, setAliases] = useState({});
  const [alarmOn, setAlarmOn] = useState(false);
  const alarmOnRef = useRef(false);
  alarmOnRef.current = alarmOn;
  const [showSmallScreenNote, setShowSmallScreenNote] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // F2 toggles the feedback terminal (matches the bottom-bar chip's keybinding).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Only when not typing in an input/textarea (Esc inside the panel handles its own close).
        const tag = (e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        setFeedbackOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem('offshoreNoteDismissed') === '1') return;
    const check = () => setShowSmallScreenNote(window.innerWidth < 1200);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  // Lightweight monitor data for the CRIMINAL zone band (active/underwater
  // counts). The inspector section owns its own copy + 1s poll for its
  // detailed views; here we just want a 3 s refresh for the band labels.
  // Keyed on sessionWallet so the band keeps refreshing data even when the
  // user navigates back to '/' (URL doesn't have the address but band still
  // shows the last-viewed wallet).
  const [liveData, setBandLive] = useState(null);
  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(sessionWallet)) { setBandLive(null); return; }
    let live = true;
    const addr = sessionWallet.toLowerCase();
    const load = () => fetch(`/api/monitor?wallet=${addr}`)
      .then(r => r.json())
      .then(d => { if (live && d && !d.error) setBandLive(d); })
      .catch(() => {});
    load();
    const t = setInterval(load, 3_000);
    return () => { live = false; clearInterval(t); };
  }, [sessionWallet]);

  // Two-way URL ↔ walletAddr sync.
  // Whenever walletAddr changes (rail input, table clicks, anything),
  // push `/criminal/<addr>` into history; clearing the address resets to `/`.
  // The popstate listener handles back/forward navigation the other way.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isFullAddr = /^0x[0-9a-fA-F]{40}$/.test(walletAddr);
    const target = isFullAddr ? `/criminal/${walletAddr.toLowerCase()}` : '/';
    if (window.location.pathname !== target) {
      window.history.pushState({}, '', target);
    }
  }, [walletAddr]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      const m = window.location.pathname.match(/^\/criminal\/(0x[0-9a-fA-F]{40})/);
      setWalletAddr(m ? m[1].toLowerCase() : '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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
    // Smooth-scroll the main scroll container back to the top so the user
    // lands on the criminal-watch chart that just appeared.
    if (typeof document !== 'undefined') {
      const main = document.querySelector('.tm-main-scroll');
      if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }
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
  const [companiesLive, setCompaniesLive] = useState(() => D.companies);

  // Audio + Notification alarm for the currently-watched criminal.
  useEffect(() => {
    if (alarmOn && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [alarmOn]);
  useEffect(() => {
    if (!alarmOnRef.current || !walletAddr || !latestNewOps?.length) return;
    const addr = walletAddr.toLowerCase();
    const mine = latestNewOps.filter(o => (o.walletFull || '').toLowerCase() === addr);
    if (!mine.length) return;
    const hasSuccess = mine.some(o => o.result === 'completed');
    const which = hasSuccess ? 'success' : 'partial';
    try { new Audio(`/sounds/${which}.mp3`).play(); } catch {}
    if (typeof document !== 'undefined' && document.hidden &&
        typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(hasSuccess ? 'Op completed' : 'Op partial / bust', { body: walletAddr.slice(0, 10) + '…', silent: true });
    }
  }, [latestNewOps]);

  const lastOpTsRef  = useRef(
    (D.recentOps && D.recentOps.length > 0) ? (D.recentOps[0]._ts || 0) : 0
  );
  const lastLiqTsRef = useRef(0);

  // ETH price (1s)
  useEffect(() => {
    const update = () =>
      fetch('/api/eth-price', { cache: 'no-cache' })
        .then(r => r.json())
        .then(({ price }) => { if (isFinite(price) && price > 0) setCounters(c => ({ ...c, eth: price })); })
        .catch(() => {});
    update();
    const t = setInterval(update, 1_000);
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
        // Keep the previous list if the tick returns an empty/missing payload —
        // an empty response (e.g. transient DB hiccup) shouldn't clear the panel.
        if (Array.isArray(d.recentStarts) && d.recentStarts.length > 0) setRecentStarts(d.recentStarts);
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
        if (d.companiesStats) setCompaniesLive(d.companiesStats);
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

  // Search autocomplete: while the user is typing a partial address or
  // alias / ENS / .mega name, show the top 5 matches from the loaded
  // `aliases` map. Empty / valid-full-address inputs skip the dropdown.
  const searchSuggestions = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    if (q.length < 2) return [];
    if (/^0x[0-9a-fA-F]{40}$/.test(q)) return [];
    const out = [];
    for (const [addr, name] of Object.entries(aliases || {})) {
      const addrLc = addr.toLowerCase();
      const nameLc = (name || '').toLowerCase();
      let score = 0;
      if (nameLc === q || addrLc === q)                score = 100;
      else if (nameLc.startsWith(q))                   score = 80;
      else if (addrLc.startsWith(q.replace(/^0x/,''))) score = 75;
      else if (addrLc.startsWith(q))                   score = 70;
      else if (nameLc.includes(q))                     score = 30;
      else if (addrLc.includes(q))                     score = 20;
      if (score > 0) out.push({ addr, name, score });
    }
    out.sort((a, b) => b.score - a.score || a.name.length - b.name.length);
    return out.slice(0, 5);
  }, [search, aliases]);

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

  // PROTOCOL band — single visible copy at any time.
  //   emissions vs burn is BELOW the viewport (user hasn't scrolled to it
  //     yet)            → bottom mirror shows in .tm-main
  //   emissions vs burn is in view OR above the viewport (user has
  //     scrolled past) → in-flow sticky copy shows at top (below search)
  // The in-flow copy is hidden (visibility:hidden, kept in flow so sticky
  // offsets stay stable) only while emissions is still below the viewport.
  const protocolRef = useRef(null);
  const [emissionsBelowView, setEmissionsBelowView] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const scrollEl = document.querySelector('.tm-main-scroll');
    if (!scrollEl) return;
    const update = () => {
      const cell = scrollEl.querySelector('[data-cell-id="emissions"]');
      if (!cell) { setEmissionsBelowView(false); return; }
      const cellRect = cell.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      // emissions is below the viewport when its top edge is past the
      // visible bottom of the scroll container.
      setEmissionsBelowView(cellRect.top > scrollRect.bottom);
    };
    update();
    scrollEl.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const t = setTimeout(update, 50);
    return () => {
      clearTimeout(t);
      scrollEl.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [walletAddr, D]);

  // Body of the PROTOCOL band — rendered both as the in-flow sticky-top
  // copy and (when needed) as a fixed-bottom mirror.
  const protocolContent = (
    <>
      <span>PROTOCOL</span>
      <span className="ctx">
        burn outpacing emission <b>{D.hero.burnedRatio}×</b> ·{' '}
        burned <b>{D.hero.burnedAllTime}</b> $dirty ·{' '}
        inf bought <b>{inf.purchased?.toLocaleString() ?? '—'}</b> ·{' '}
        daily active <b>{counters.daw?.toLocaleString() ?? '—'}</b>
        {dawPct > 0 ? ` (▾ ${dawPct}%)` : ' (peak)'} ·{' '}
        world <b>{D.currentWorldTime || 'Q4 2012'}</b>
      </span>
    </>
  );

  // CRIMINAL band — rendered ABOVE the search bar (outside the scroll
  // container) so the search input sits exactly underneath it. Driven by
  // sessionWallet so it stays visible even on '/' once the user has loaded
  // any wallet (localStorage-backed). Clicking it navigates to
  // /criminal/<address> to bring back the full criminal-zone content.
  const criminalBand = /^0x[0-9a-fA-F]{40}$/.test(sessionWallet) ? (() => {
    const allComp = liveData?.companies ?? [];
    const activeComps = allComp.filter(c => c.active && c.endTime > 0);
    // Count companies with buffer < $3 (matches the polizia panel rule
     // for "at risk" — anything thinner than $3 between ETH and liq price).
    const underwater = activeComps.filter(c => {
      if (!c.liqPrice) return false;
      const liqUsd = Number(BigInt(c.liqPrice) / 10n ** 12n) / 1e6;
      return counters.eth > 0 && (counters.eth - liqUsd) < 3;
    }).length;
    const walletLc = sessionWallet.toLowerCase();
    const lastOp   = ops.find(o => (o.walletFull || '').toLowerCase() === walletLc);
    const lastOpAgo = lastOp ? relAgo(lastOp._ts) : null;
    // Hide the address badge while the user is mid-typing in the search box.
    // It only shows again when the input is empty or holds a complete 0x...
    // address (40 hex chars).
    const hideBadge = !!search && !/^0x[0-9a-fA-F]{40}$/.test(search);
    const onBandClick = () => {
      // If user is on '/' (no wallet active for content), load the criminal-zone
      // content. Otherwise just scroll back to the top of it.
      if (walletAddr !== sessionWallet) {
        setWalletAddr(sessionWallet);
      } else {
        const scrollEl = document.querySelector('.tm-main-scroll');
        if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    return (
      <div
        className="tm-zone-band is-criminal"
        style={{ cursor: 'pointer' }}
        title={walletAddr === sessionWallet ? 'click to scroll to criminal zone' : 'click to open criminal page'}
        onClick={onBandClick}
      >
        <span className="dot" />
        <span>CRIMINAL</span>
        {!hideBadge && <span className="badge">{shortAddr(sessionWallet)}</span>}
        <span className="ctx">
          <b>{activeComps.length}</b> active ·{' '}
          <b>{underwater}</b> underwater ·{' '}
          last op <b>{lastOpAgo ?? '—'}</b> ago
        </span>
      </div>
    );
  })() : null;

  // PROTOCOL bottom mirror — sits inside .tm-main (via bottomBand) so it
  // skips the sidebar. Shown only while emissions vs burn is still below
  // the viewport (user hasn't scrolled to it). Once emissions enters view
  // or passes above the top, the in-flow sticky copy takes over.
  const protocolMirror = emissionsBelowView ? (
    <div
      className="tm-zone-band is-protocol"
      style={{ position: 'static', cursor: 'pointer' }}
      title="click to scroll protocol zone into view"
      onClick={() => {
        const el = protocolRef.current;
        const scrollEl = document.querySelector('.tm-main-scroll');
        if (!el || !scrollEl) return;
        const next = el.nextElementSibling;
        const target = next
          ? next.offsetTop - el.offsetHeight
          : el.offsetTop;
        scrollEl.scrollTo({ top: target, behavior: 'smooth' });
      }}
    >
      {protocolContent}
    </div>
  ) : null;

  return (
    <TerminalShell
      mode="standalone"
      brand={{ name: 'OFFSHORE', sub: 'community dashboard · v1.0.0', season: 'SEASON 2' }}
      nav={NAV}
      apps={D.apps}
      activeAppId={activeApp}
      onAppChange={setActiveApp}
      ticker={ticker}
      // Top search reflects the watched criminal when one is loaded;
      // otherwise it's the free-text filter consumed by TradesSection.
      search={walletAddr || search}
      onSearch={(v) => {
        if (v === '') {
          setWalletAddr('');
          setSearch('');
        } else if (/^0x[0-9a-fA-F]{40}$/.test(v)) {
          setWalletAddr(v.toLowerCase());
          setSearch('');
        } else {
          setWalletAddr('');
          setSearch(v);
        }
      }}
      sideFooter={sideFoot}
      fkeys={[
        {
          label:   feedbackOpen ? '× close' : '✉ feedback',
          color:   'var(--t-fg)',  // same as the <b> key-letter color (the "F2" tint)
          center:  true,
          onClick: () => setFeedbackOpen(o => !o),
        },
      ]}
      sideContent={<LiveSidebar D={D} counters={counters} ops={ops} watch={watch} trades={liveTicker} recentStarts={recentStarts} onWallet={openWallet} aliases={aliases} />}
      topBand={criminalBand}
      bottomBand={protocolMirror}
      searchSuggestions={searchSuggestions}
      onPickSuggestion={(addr) => {
        const lc = addr.toLowerCase();
        setWalletAddr(lc);
        setSearch('');
      }}
      theme={theme}
      onThemeChange={onThemeChange}
      notifPrefs={notifs}
      onNotifChange={setNotifs}
      density={density}
    >
      <div className="tm-content">
        {showSmallScreenNote && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 12px',
            fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs-xs)',
            color: 'var(--t-fg-soft)',
            background: 'var(--t-bg-soft, transparent)',
            borderBottom: '1px dotted var(--t-rule)',
          }}>
            <span style={{ opacity: 0.85 }}>optimized for desktop · small / lower screens may break layout</span>
            <span
              title="dismiss"
              onClick={() => { setShowSmallScreenNote(false); try { sessionStorage.setItem('offshoreNoteDismissed', '1'); } catch {} }}
              style={{ cursor: 'pointer', marginLeft: 'auto', padding: '0 4px', color: 'var(--t-fg-mut)' }}
            >×</span>
          </div>
        )}
        {/^0x[0-9a-fA-F]{40}$/.test(walletAddr) && (
          <div className="tm-zone-criminal">
            <CriminalChartSection   address={walletAddr} grid={grid} ethPrice={counters.eth} alarmOn={alarmOn} onAlarmToggle={() => setAlarmOn(v => !v)} liveData={liveData} />
            <WalletInspectorSection address={walletAddr} grid={grid} ethPrice={counters.eth} liveData={liveData} />
          </div>
        )}

        {/* PROTOCOL — sticky-top inside the scroll. When the user is high
            enough that this in-flow copy hasn't entered view yet, a fixed
            mirror appears at the bottom of the scroll container (see
            below) so the band is always visible. */}
        <div
          ref={protocolRef}
          className="tm-zone-band is-protocol"
          style={{
            cursor: 'pointer',
            top: 0,
            // hide the in-flow copy only while emissions is still below
            // the viewport (the bottom mirror is the visible copy then).
            // Keep it in the flow (not display:none) so sticky offsets
            // stay stable; once emissions is in view OR above, the
            // in-flow band is the visible copy at top.
            visibility: emissionsBelowView ? 'hidden' : 'visible',
          }}
          title="click to scroll protocol zone into view"
          onClick={(e) => {
            const band = e.currentTarget;
            const scrollEl = band.closest('.tm-main-scroll');
            const next = band.nextElementSibling;
            if (!scrollEl || !next) return scrollBandToTop(band, 0);
            // Land emissions vs burns flush under the pinned PROTOCOL band
            // (cancels out the .tm-content gap between band and TokenSection).
            const target = next.offsetTop - band.offsetHeight;
            scrollEl.scrollTo({ top: target, behavior: 'smooth' });
          }}
        >
          {protocolContent}
        </div>

        <TokenSection    D={{ ...D, companies: companiesLive || D.companies }} grid={grid} />
        <PlayersSection  D={D} grid={grid} />
        <VaultSection    D={D} grid={grid} />
        <TradesSection   grid={grid} liveTrades={liveTrades} ops={ops} search={search} ethPrice={counters.eth} aliases={aliases} onWallet={openWallet} />
        <HitsSection     D={D} grid={grid} aliases={aliases} onWallet={openWallet} />
        <StakingSection  grid={grid} aliases={aliases} onWallet={openWallet} />
      </div>

      {showToasts && <Toasts items={filteredTicker} />}
      <FeedbackTerminal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </TerminalShell>
  );
}
