'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { TerminalShell, Toasts, LabelChip } from './terminal.jsx';
import { InfTooltip, computeWatch, fmtK } from './trade-helpers.jsx';
import { DEMO, GENESIS, bucketAt } from '../../lib/demo-constants.js';
import { useVirtualClock, useVirtualNow } from './hooks/use-virtual-clock.js';
import { TimeBar } from './TimeBar.jsx';
import { DemoIntro } from './DemoIntro.jsx';
import { getCycleStart, SEASON2_START, isWeekendTs } from '../api/offshore-data/helpers.js';

function nowHMS() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

// Feed rows carry their own on-chain timestamp — in demo/replay the wall
// clock is meaningless, so format the row's virtual moment (UTC).
function tsHMS(ts) {
  const d = new Date(Number(ts) * 1000);
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())}`;
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

function relAgo(ts, nowSec = null) {
  const diff = (nowSec ?? Math.floor(Date.now() / 1000)) - Number(ts);
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
import { CycleEarnersSection } from './sections/CycleEarnersSection.jsx';

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
  'indexed-stats':      6,
  'recent-activity':    6,
  'farmed-daily':       6,
  'enterprises-user':   6,
  'trades':             6,
  'ops':                6,
  'company-state':      5,
  'staking-chart':      7,
  'hits-table':         7,
  'hits-chart':         5,
  'cycle-earners':     12,
  'enterprises':       12,
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
  // Virtual clock: in live mode this ticks at 1× wall time; in demo it's the
  // replay clock every panel renders against.
  const clock = useVirtualClock();
  const vnow  = useVirtualNow(1000);
  // vnow lags one render behind the clock on seeks — vnowNow() reads the
  // authoritative value; vnowRef serves closures that run between renders.
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const vnowNow = () => (clockRef.current ? clockRef.current.nowSec() : Math.floor(Date.now() / 1000));
  const vnowRef = useRef(vnow);
  vnowRef.current = vnow;
  const seekNonce = clock?.seekNonce ?? 0;
  const playSpeed = clock?.speed ?? 0;
  const seekNonceRef = useRef(seekNonce);
  seekNonceRef.current = seekNonce;
  const speedRef = useRef(playSpeed);
  speedRef.current = playSpeed;

  // Mirror the initial server payload into state, then refresh it from
  // /api/offshore-data so aggregate stats (hero, charts, influence totals,
  // leaderboard, etc.) don't drift on long sessions. Live: every 60s. Demo:
  // immediately on seek, then on a real-time cadence matched to replay speed
  // (paused → no refetch; the minute-bucketed `at` makes server caching easy).
  const [D, setD] = useState(initialD);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      const url = DEMO
        ? `/api/offshore-data?at=${bucketAt(vnowNow(), 60)}`
        : '/api/offshore-data';
      return fetch(url)
        .then(r => r.json())
        .then(d => { if (live && d && !d.error) setD(d); })
        .catch(() => {});
    };
    if (!DEMO) {
      const t = setInterval(refresh, 60_000);
      return () => { live = false; clearInterval(t); };
    }
    refresh(); // seek / mount → immediate as-of payload
    if (playSpeed <= 0) return () => { live = false; };
    const cadence = playSpeed >= 3600 ? 15_000 : playSpeed >= 60 ? 30_000 : 60_000;
    const t = setInterval(refresh, cadence);
    return () => { live = false; clearInterval(t); };
  }, [seekNonce, playSpeed]);

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
  const [showDemoNote, setShowDemoNote] = useState(() => {
    if (!DEMO || typeof window === 'undefined') return false;
    try {
      // ?intro=0 suppresses the intro modal (embeds / screenshots).
      if (new URL(window.location.href).searchParams.get('intro') === '0') return false;
      return sessionStorage.getItem('offshoreDemoNoteDismissed') !== '1';
    } catch { return true; }
  });
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
  // Demo: refetch when the 10-virtual-second bucket moves (paused ⇒ one load).
  const monitorAtBucket = DEMO ? bucketAt(vnow, 10) : null;
  useEffect(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(sessionWallet)) { setBandLive(null); return; }
    let live = true;
    const addr = sessionWallet.toLowerCase();
    const load = () => fetch(`/api/monitor?wallet=${addr}${DEMO ? `&at=${bucketAt(vnowRef.current, 10)}` : ''}`)
      .then(r => r.json())
      .then(d => { if (live && d && !d.error) setBandLive(d); })
      .catch(() => {});
    load();
    if (DEMO) return () => { live = false; };
    const t = setInterval(load, 3_000);
    return () => { live = false; clearInterval(t); };
  }, [sessionWallet, monitorAtBucket]);

  // Cycle chip state. Live: polled from the offshoreprotocol.fun upstream.
  // Demo: computed locally from the virtual clock via the Season-aware
  // getCycleStart — it ticks at replay speed and handles the S1 8h branch.
  const [cycleInfo, setCycleInfo] = useState(null);
  useEffect(() => {
    if (DEMO) return;
    let live = true;
    const load = () => fetch('/api/cycles/current')
      .then(r => r.json())
      .then(d => { if (live && d && d.cycle) setCycleInfo(d.cycle); })
      .catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const demoCycle = useMemo(() => {
    if (!DEMO) return null;
    const start = getCycleStart(vnow);
    const dur = vnow >= SEASON2_START ? 86400 : (isWeekendTs(vnow) ? 86400 : 28800);
    const totalTicks = Math.floor(dur / 96);
    // The payload's ordinal is as of D.asOf; advance it by cycle boundaries
    // the replay has crossed since, so it doesn't freeze between refetches.
    let cycleId = D?.currentCycleId ?? null;
    if (cycleId != null && D?.asOf != null) {
      let t = getCycleStart(Number(D.asOf));
      let guard = 0;
      while (t + (t >= SEASON2_START ? 86400 : (isWeekendTs(t) ? 86400 : 28800)) <= vnow && guard++ < 512) {
        t += t >= SEASON2_START ? 86400 : (isWeekendTs(t) ? 86400 : 28800);
        cycleId += 1;
      }
    }
    return {
      cycleId,
      currentTick: Math.min(totalTicks, Math.floor((vnow - start) / 96)),
      totalTicks,
      timeRemaining: Math.max(0, start + dur - vnow),
    };
  }, [vnow, D?.currentCycleId, D?.asOf]);

  // Two-way URL ↔ walletAddr sync.
  // Whenever walletAddr changes (rail input, table clicks, anything),
  // push `/criminal/<addr>` into history; clearing the address resets to `/`.
  // The query string (?at=…&speed=…) must survive the pathname swap.
  // The popstate listener handles back/forward navigation the other way.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isFullAddr = /^0x[0-9a-fA-F]{40}$/.test(walletAddr);
    const target = isFullAddr ? `/criminal/${walletAddr.toLowerCase()}` : '/';
    if (window.location.pathname !== target) {
      window.history.pushState({}, '', target + window.location.search);
    }
  }, [walletAddr]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      const m = window.location.pathname.match(/^\/criminal\/(0x[0-9a-fA-F]{40})/);
      setWalletAddr(m ? m[1].toLowerCase() : '');
      if (DEMO && clock) {
        const raw = new URL(window.location.href).searchParams.get('at');
        const n = raw ? (/^\d{9,12}$/.test(raw) ? Number(raw) : Math.floor(Date.parse(raw) / 1000)) : NaN;
        if (Number.isFinite(n) && Math.abs(n - clock.nowSec()) > 90) clock.seek(n);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [clock]);

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
    opsMin:    ci.opsMin  || 0,
    opsHour:   ci.opsHour || 0,
    dirty:     ci.dirty   || 0.0706,
    opCost:    ci.opCost  || 12.41,
    gas:       ci.gas     || 0.001,
    eth:       ci.eth ?? D.liveTrades[0]?.ethPrice ?? 0,
    activeOps: D.activeCompanies ?? 0,
    tps:       0,
    _bump:     0,
    _lastOkAt: Date.now(),  // last successful live-tick — used to decide if RPC is "live"
  }));
  const [ops, setOps] = useState(() =>
    (D.recentOps && D.recentOps.length > 0)
      ? D.recentOps.slice(0, 250).map(o => ({ ...o, time: DEMO ? tsHMS(o._ts) : nowHMS() }))
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
  // Ticker-event cursor — a ref (not a pump-closure variable) so seeks can
  // reset it; the pump effect mounts once and would otherwise hold it stale.
  const lastEventTsRef = useRef((initialD.liveTradeTicker && initialD.liveTradeTicker[0]?._ts) || 0);

  // Seek handling (demo): clear the animated feeds, reset the pump cursor to
  // the new virtual moment, and reseed from the next as-of payload.
  const pendingSeedRef = useRef(false);
  const firstSeekRef = useRef(true);
  useEffect(() => {
    if (!DEMO) return;
    if (firstSeekRef.current) { firstSeekRef.current = false; return; }
    lastOpTsRef.current = vnowNow();
    lastEventTsRef.current = 0;
    pendingSeedRef.current = true;
    setOps([]);
    setLiveTicker([]);
    setLatestNewOps([]);
    setRecentStarts([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekNonce]);
  useEffect(() => {
    if (!DEMO || !pendingSeedRef.current || !D) return;
    pendingSeedRef.current = false;
    setOps((D.recentOps || []).slice(0, 250).map(o => ({ ...o, time: tsHMS(o._ts) })));
    setLiveTicker(D.liveTradeTicker || []);
    lastEventTsRef.current = (D.liveTradeTicker && D.liveTradeTicker[0]?._ts) || 0;
    setRecentStarts(D.recentStarts || []);
    setWatchRaw(D.liveTrades || []);
    setLiveTrades(D.liveTrades || []);
    if (D.recentOps?.length) lastOpTsRef.current = Math.max(lastOpTsRef.current, D.recentOps[0]._ts || 0);
  }, [D]);

  // ETH price (1s) — live only; the demo dataset has no ETH history.
  useEffect(() => {
    if (DEMO) return;
    const update = () =>
      fetch('/api/eth-price', { cache: 'no-cache' })
        .then(r => r.json())
        .then(({ price }) => { if (isFinite(price) && price > 0) setCounters(c => ({ ...c, eth: price })); })
        .catch(() => {});
    update();
    const t = setInterval(update, 1_000);
    return () => clearInterval(t);
  }, []);

  // Live tick (800ms): counters, new ops, live trades, ticker events.
  // In demo the same cadence pumps the recorded tape forward: ?at= is the
  // virtual moment and ?since= the cursor, so each tick returns the ops that
  // "happened" since the previous one at the current replay speed.
  useEffect(() => {
    let live = true;
    let inflight = false;  // skip overlapping ticks when RPC is slow
    const tick = async () => {
      if (!live || inflight) return;
      inflight = true;
      try {
        const nonce = seekNonceRef.current;
        const vnowAt = vnowNow();
        if (DEMO && speedRef.current > 0) {
          // At high replay speed the tape emits far more ops than LIMIT 60
          // per tick can drain — clamp the cursor to a trailing window (~3
          // real seconds of virtual time) so the feed samples near "now"
          // instead of falling ever further behind.
          const minSince = vnowAt - Math.max(120, speedRef.current * 3);
          if (lastOpTsRef.current < minSince) lastOpTsRef.current = minSince;
        }
        const at = DEMO ? `at=${vnowAt}&` : '';
        const res = await fetch(`/api/offshore-data/live?${at}since=${lastOpTsRef.current}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error('non-ok');
        const d = await res.json();
        // A seek happened while this tick was in flight — its data belongs
        // to the previous virtual moment; drop it.
        if (nonce !== seekNonceRef.current) return;
        setCounters((c) => ({
          ...c,
          block:   d.block   ?? c.block,
          daw:     d.daw     ?? c.daw,
          opsMin:  d.opsMin  ?? c.opsMin,
          opsHour: d.opsHour ?? c.opsHour,
          dirty:   d.dirty   ?? c.dirty,
          opCost:  d.opCost  ?? c.opCost,
          gas:     d.gas     ?? c.gas,
          // Demo: the live tick carries the as-of oracle value; live mode
          // keeps the dedicated 1s /api/eth-price poll as the source.
          eth:       DEMO ? (d.eth ?? c.eth) : c.eth,
          activeOps: d.activeOps ?? c.activeOps,
          tps:       d.tps       ?? c.tps,
          _bump:  c._bump + 1,
          _lastOkAt: Date.now(),
        }));
        if (d.newOps && d.newOps.length > 0) {
          // Always advance the cursor to the newest returned row — at 3600×
          // each tick spans ~48 virtual minutes and the server LIMIT
          // saturates; drop-oldest sampling keeps the feed a fast tape
          // instead of an ever-lagging backlog.
          lastOpTsRef.current = d.newOps[d.newOps.length - 1]._ts;
          const rows = DEMO ? d.newOps.slice(-30) : d.newOps;
          setOps((prev) => {
            // Dedupe against existing — overlapping polls can return the same row twice.
            // Key: hash + walletFull + op (matches server-side dedup); fall back to wallet+op+_ts.
            const seen = new Set(prev.map(o => `${o.hash || ''}:${o.walletFull || o.wallet}:${o.op}:${o._ts || ''}`));
            const incoming = rows
              .filter(o => !seen.has(`${o.hash || ''}:${o.walletFull || o.wallet}:${o.op}:${o._ts || ''}`))
              .map(o => ({ ...o, time: DEMO ? tsHMS(o._ts) : nowHMS() }))
              .reverse();
            return [...incoming, ...prev].slice(0, 250);
          });
          setLatestNewOps(rows);
        }
        if (d.liveTrades && (d.liveTrades.length > 0 || DEMO)) {
          setWatchRaw(d.liveTrades);
          setLiveTrades(d.liveTrades);
        }
        // Keep the previous list if the tick returns an empty/missing payload —
        // an empty response (e.g. transient DB hiccup) shouldn't clear the panel.
        // Demo reconstruction is authoritative, so empty is real there.
        if (Array.isArray(d.recentStarts) && (d.recentStarts.length > 0 || DEMO)) setRecentStarts(d.recentStarts);
        if (d.latestEvent && d.latestEvent._ts > lastEventTsRef.current) {
          lastEventTsRef.current = d.latestEvent._ts;
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
        // Tick failed — keep the last good values. Random-walking the counters
        // made the panel look alive while actually displaying made-up numbers.
      } finally {
        inflight = false;
      }
    };
    const t = setInterval(tick, 800);
    return () => { live = false; clearInterval(t); };
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  const watch = useMemo(() => computeWatch(watchRaw, counters.eth, vnow), [watchRaw, counters.eth, vnow]);

  // Set of addresses that have actually farmed ≥1 $dirty from a game op.
  // Used to narrow the search dropdown to real players (funders / ENS-only
  // wallets with no game activity are filtered out).
  const [activePlayers, setActivePlayers] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/active-players')
      .then(r => r.json())
      .then(d => { if (alive && Array.isArray(d?.addresses)) setActivePlayers(new Set(d.addresses)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Search autocomplete: while the user is typing a partial address or
  // alias / ENS / .mega name, show the top 5 matches from the loaded
  // `aliases` map. Empty / valid-full-address inputs skip the dropdown.
  const searchSuggestions = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    if (q.length < 2) return [];
    if (/^0x[0-9a-fA-F]{40}$/.test(q)) return [];
    const out = [];
    for (const [addr, name] of Object.entries(aliases || {})) {
      // Only suggest wallets that have actually farmed game dirty (>0 from
      // DRUG/ARMS/EXTORTION mints). Funders / pure-DEX wallets are hidden.
      if (activePlayers && !activePlayers.has(addr.toLowerCase())) continue;
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
  }, [search, aliases, activePlayers]);

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
  // CYCLE chip — sits immediately to the left of the clock (right side of
  // the ticker), not interleaved with the regular cells. Format: "29 ·
  // 493/900 · 10:50:32".
  const activeCycle = DEMO ? demoCycle : cycleInfo;
  const cycleChip = (() => {
    if (!activeCycle) return null;
    const tr = Number(activeCycle.timeRemaining) || 0;
    const hh = String(Math.floor(tr / 3600)).padStart(2, '0');
    const mm = String(Math.floor((tr % 3600) / 60)).padStart(2, '0');
    const ss = String(tr % 60).padStart(2, '0');
    const id = activeCycle.cycleId ?? '—';
    return (
      <span
        className="tm-ticker-cell"
        style={{ marginLeft: 'auto' }}  // pin to the right, just before the clock
        title={`cycle ${id} · tick ${activeCycle.currentTick}/${activeCycle.totalTicks} · ends in ${hh}:${mm}:${ss}`}
      >
        <span className="tm-ticker-k">CYCLE</span>
        <span className="tm-ticker-v">
          {id} · {activeCycle.currentTick}/{activeCycle.totalTicks} · {hh}:{mm}:{ss}
        </span>
      </span>
    );
  })();

  // ETH comes from the backfilled RedStone oracle tape in demo — the exact
  // as-of value; demo also adds a VAULT cell (cumulative distributed).
  const ticker = [
    { k: '$DIRTY',  v: `$${counters.dirty.toFixed(4)}`,     trend: pct(counters.dirty,  base.dirty) },
    { k: 'OP COST', v: `${counters.opCost.toFixed(2)} INF`, trend: pct(counters.opCost, base.infCost), tooltip: <InfTooltip data={D.infCostHistory || []} current={counters.opCost} trend={pct(counters.opCost, base.infCost)} /> },
    { k: 'ETH',     v: `$${counters.eth.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, trend: pct(counters.eth, base.eth) },
    ...(DEMO ? [{ k: 'VAULT', v: `$${fmtK(D.distributionTotals?.total ?? 0)}` }] : []),
    { k: 'SUPPLY',  v: fmtK(D.hero.supply) },
    { k: 'MC',      v: `$${fmtK(latestMc)}` },
  ];

  // 5s grace before we flip to "down" so brief blips don't flicker the indicator.
  const rpcLive = Date.now() - (counters._lastOkAt ?? 0) < 5000;
  const sideFoot = DEMO
    ? [
        { k: 'mode',  v: playSpeed > 0 ? `replay ${playSpeed}×` : 'as-of', cls: playSpeed > 0 ? 'pos' : 'warn' },
        { k: 'block', v: (vnow - GENESIS).toLocaleString() },
      ]
    : [
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
    // Live: count companies with buffer < $3 (matches the polizia rule).
    // Demo: liq buffers don't exist historically — count trades ending <5m.
    const underwater = DEMO
      ? activeComps.filter(c => c.endTime > vnow && c.endTime - vnow < 300).length
      : activeComps.filter(c => {
          if (!c.liqPrice) return false;
          const liqUsd = Number(BigInt(c.liqPrice) / 10n ** 12n) / 1e6;
          return counters.eth > 0 && (counters.eth - liqUsd) < 3;
        }).length;
    const walletLc = sessionWallet.toLowerCase();
    const lastOp   = ops.find(o => (o.walletFull || '').toLowerCase() === walletLc);
    const lastOpAgo = lastOp ? relAgo(lastOp._ts, vnow) : null;
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
        {liveData?.label?.label && (
          <LabelChip label={liveData.label.label} size="xs" />
        )}
        <span className="ctx">
          <b>{activeComps.length}</b> active ·{' '}
          <b>{underwater}</b> {DEMO ? 'ending <5m' : 'underwater'} ·{' '}
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
      brand={{ name: 'OFFSHORE', sub: 'community dashboard · v1.0.1', season: 'SEASON 2' }}
      nav={NAV}
      apps={D.apps}
      activeAppId={activeApp}
      onAppChange={setActiveApp}
      ticker={ticker}
      clock={DEMO ? `${tsHMS(vnow)} UTC` : undefined}
      timeBar={DEMO ? <TimeBar /> : null}
      clockExtras={cycleChip}
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
            <CriminalChartSection   address={walletAddr} grid={grid} ethPrice={counters.eth} alarmOn={alarmOn} onAlarmToggle={() => setAlarmOn(v => !v)} liveData={liveData} now={vnow} />
            <WalletInspectorSection address={walletAddr} grid={grid} ethPrice={counters.eth} liveData={liveData} now={vnow} />
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
        <TradesSection   grid={grid} liveTrades={liveTrades} ops={ops} search={search} ethPrice={counters.eth} aliases={aliases} onWallet={openWallet} now={vnow} />
        <section id="sec-leaderboards" className="tm-grid-12">
          <CycleEarnersSection grid={grid} aliases={aliases} onWallet={openWallet} noSection />
        </section>
        <HitsSection     D={D} grid={grid} aliases={aliases} onWallet={openWallet} />
        <StakingSection  grid={grid} aliases={aliases} onWallet={openWallet} />
      </div>

      {showToasts && <Toasts items={filteredTicker} />}
      {showDemoNote && (
        <DemoIntro
          moment={new Date(vnow * 1000).toISOString().slice(0, 16).replace('T', ' ')}
          onClose={() => { setShowDemoNote(false); try { sessionStorage.setItem('offshoreDemoNoteDismissed', '1'); } catch {} }}
        />
      )}
      <FeedbackTerminal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </TerminalShell>
  );
}
