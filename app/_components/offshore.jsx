'use client';
import { useState, useMemo, useRef, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  TerminalShell, Region, Stats, KV, KVSep, BarRow, BarRow2, StackedBarRow,
  BlockRow, Spark, MultiSpark, Heatmap, AsciiBarChart, LineChart, Seg, Sortable, GridCell, Toasts, fmt,
} from './terminal.jsx';
import {
  CHART_AXIS, TmTooltip, InfTooltip, fmtCountdownLocal, computeWatch,
  renderTradeRows, fmtLocal, fmtLocalHour, localDates,
} from './trade-helpers.jsx';
import { LiveSidebar } from './LiveSidebar.jsx';
import { WalletRail } from './WalletRail.jsx';

export function OffshoreDashboard({ D, showToasts = true, showRail = true, theme = 'purple', density = 'regular', onThemeChange }) {
  // ── State ──────────────────────────────────────────────────────────────
  const [activeApp, setActiveApp] = useState('offshore');
  const [tab, setTab] = useState('dashboard');
  const [search, setSearch] = useState('');

  const cellPairs = {
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
  const [spans, setSpans] = useState({
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
  });
  const [heights, setHeights] = useState({ supply: 360, 'influence-daily': 200 });

  function resizeCell(id, { span, height }) {
    if (span != null) {
      const partner = cellPairs[id];
      setSpans((s) => {
        if (!partner) return { ...s, [id]: span };
        const clamped = Math.max(3, Math.min(9, span));
        return { ...s, [id]: clamped, [partner]: 12 - clamped };
      });
    }
    if (height != null) setHeights((h) => ({ ...h, [id]: height }));
  }
  const [econGran, setEconGran]  = useState(() =>
    typeof window !== 'undefined' && window.innerWidth <= 720 ? 'daily' : 'hourly'
  );
  const [supplyGran, setSupplyGran] = useState('daily');
  const [infGran, setInfGran]    = useState('daily');
  const [notifs, setNotifs] = useState({ 'buys & sells': true, 'operations': true, 'staking': true, 'liquidations': true });
  const [burnRange, setBurnRange] = useState('all');
  const [trxRange, setTrxRange] = useState('all');
  const [sortKey, setSortKey] = useState('endsIn');
  const [sortDir, setSortDir] = useState('asc');
  const [focusPane, setFocusPane] = useState(null);
  const [stakingData, setStakingData] = useState(null);
  const [aliases, setAliases] = useState({});
  const [watchRaw, setWatchRaw] = useState(() => D.liveTrades || []);
  const [liveTradesData, setLiveTradesData] = useState(() => D.liveTrades || []);
  const [walletAddr, setWalletAddr] = useState('');
  const openRailRef = useRef(null);

  function openWallet(fullAddr) {
    setWalletAddr(fullAddr);
    if (openRailRef.current) openRailRef.current();
  }

  useEffect(() => {
    fetch('/api/staking').then(r => r.json()).then(setStakingData).catch(() => {});
    const t = setInterval(() => {
      fetch('/api/staking').then(r => r.json()).then(setStakingData).catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch('/api/aliases').then(r => r.json()).then(setAliases).catch(() => {});
    const t = setInterval(() => {
      fetch('/api/aliases').then(r => r.json()).then(setAliases).catch(() => {});
    }, 120_000);
    return () => clearInterval(t);
  }, []);

  // ── Live ops feed ────────────────────────────────────────────────────
  const [ops, setOps] = useState(() =>
    (D.recentOps && D.recentOps.length > 0)
      ? D.recentOps.slice(0, 250).map(o => ({ ...o, time: nowHMS() }))
      : []
  );
  const lastOpTsRef  = useRef(
    (D.recentOps && D.recentOps.length > 0) ? (D.recentOps[0]._ts || 0) : 0
  );
  const lastLiqTsRef = useRef(0);

  // ── Filter / sort trades ──────────────────────────────────────────────
  const tradesFiltered = useMemo(() => {
    let arr = liveTradesData;
    if (search) arr = arr.filter((r) => r.id.toLowerCase().includes(search.toLowerCase()));
    arr = [...arr];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const x = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? x : -x;
    });
    return arr;
  }, [search, sortKey, sortDir, liveTradesData]);

  const underwaterCount = liveTradesData.filter((r) => r.buffer < 0).length;

  const participantsChart = useMemo(() => {
    const players = D.totalPlayersChart || [];
    return D.dailyActiveWallets.map((d, i) => ({
      x: d.ts ? fmtLocal(d.ts) : d.x,
      daw: d.v,
      players: players[i]?.v ?? 0,
    }));
  }, [D]);

  function sortBy(k) {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  }

  // ── Section nav ───────────────────────────────────────────────────────
  const nav = [
    { id: 'overview',    label: 'overview' },
    { id: 'token',       label: 'token' },
    { id: 'players',     label: 'players' },
    { id: 'vault',       label: 'vault' },
    { id: 'trades',      label: 'trades' },
  ];

  // ── Live counters + event ticker ─────────────────────────────────────
  const ci = D.counterInit || {};
  const [counters, setCounters] = useState(() => ({
    block:  ci.block  || 4128907,
    daw:        ci.daw    || 930,
    opsMin:     ci.opsMin || 4.2,
    dirty:      ci.dirty  || 0.0706,
    opCost:     ci.opCost || 12.41,
    gas:        ci.gas    || 0.001,
    eth:        D.liveTrades[0]?.ethPrice ?? 0,
    activeOps:  D.activeCompanies ?? 0,
    tps:    0,
    _bump: 0,
  }));
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

  const [liveTicker, setLiveTicker] = useState(() => D.liveTradeTicker || []);
  const [latestNewOps, setLatestNewOps] = useState([]);
  const filteredTicker = useMemo(() => liveTicker.filter(item => {
    if ((item.kind === 'buy' || item.kind === 'sell') && !notifs['buys & sells']) return false;
    if (item.kind === 'op' && !notifs['operations']) return false;
    if (item.kind === 'stake' && !notifs['staking']) return false;
    if (item.kind === 'liquidation' && !notifs['liquidations']) return false;
    return true;
  }), [liveTicker, notifs]);
  useEffect(() => {
    let live = true;
    let lastEventTs = (D.liveTradeTicker && D.liveTradeTicker[0]?._ts) || 0;
    const tick = async () => {
      if (!live) return;
      try {
        const res = await fetch(`/api/offshore-data/live?since=${lastOpTsRef.current}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error('non-ok');
        const d = await res.json();
        setCounters((c) => ({
          ...c,
          block:  d.block  ?? (c.block  + 1 + Math.floor(Math.random() * 3)),
          daw:    d.daw    ?? c.daw,
          opsMin: d.opsMin ?? Math.max(0, c.opsMin + (Math.random() - 0.5) * 0.6),
          dirty:  d.dirty  ?? Math.max(0.001, c.dirty  + (Math.random() - 0.5) * 0.0008),
          opCost: d.opCost ?? Math.max(0, c.opCost + (Math.random() - 0.5) * 0.04),
          gas:    d.gas    ?? Math.max(0, c.gas    + (Math.random() - 0.5) * 0.0002),
          eth:       c.eth,
          activeOps: d.activeOps ?? c.activeOps,
          tps:    d.tps    ?? c.tps,
          _bump:  c._bump + 1,
        }));
        if (d.newOps && d.newOps.length > 0) {
          const ts = nowHMS();
          lastOpTsRef.current = d.newOps[d.newOps.length - 1]._ts;
          setOps((prev) => [...d.newOps.map(o => ({ ...o, time: ts })).reverse(), ...prev].slice(0, 250));
          setLatestNewOps(d.newOps);
        }
        if (d.liveTrades && d.liveTrades.length > 0) {
          setWatchRaw(d.liveTrades);
          setLiveTradesData(d.liveTrades);
        }
        if (d.latestEvent && d.latestEvent._ts > lastEventTs) {
          lastEventTs = d.latestEvent._ts;
          setLiveTicker((prev) => [d.latestEvent, ...prev].slice(0, 60));
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
          dirty:  Math.max(0.001, c.dirty  + (Math.random() - 0.5) * 0.0008),
          opCost: Math.max(0, c.opCost + (Math.random() - 0.5) * 0.04),
          gas:    Math.max(0, c.gas    + (Math.random() - 0.5) * 0.0002),
          _bump:  c._bump + 1,
        }));
      }
    };
    const t = setInterval(tick, 800);
    return () => { live = false; clearInterval(t); };
  }, []);

  // ── 1s tick for live countdown / buffer columns ──────────────────────────
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Watch: recompute on every eth price tick or new trade data ───────────
  const watch = useMemo(() => computeWatch(watchRaw, counters.eth), [watchRaw, counters.eth]);

  // ── Ticker / fkeys / sidebar config ───────────────────────────────────
  const base = D.priceBase25h || {};
  function pct(current, baseline) {
    if (!baseline || !current) return null;
    return ((current - baseline) / baseline) * 100;
  }
  const ticker = [
    { k: '$DIRTY',  v: `$${counters.dirty.toFixed(4)}`,     trend: pct(counters.dirty,  base.dirty) },
    { k: 'OP COST', v: `${counters.opCost.toFixed(2)} INF`, trend: pct(counters.opCost, base.infCost), tooltip: <InfTooltip data={D.infCostHistory || []} current={counters.opCost} trend={pct(counters.opCost, base.infCost)} /> },
    { k: 'ETH',     v: `$${counters.eth.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, trend: pct(counters.eth, base.eth) },
  ];

  const sideFoot = [
    { k: 'rpc',   v: 'live', cls: 'pos' },
    { k: 'block', v: counters.block.toLocaleString() },
    { k: 'gas',   v: counters.gas.toFixed(4) },
    { k: 'tps',   v: counters.tps > 0 ? counters.tps.toLocaleString() : '—' },
  ];

  // ── Derived metrics ───────────────────────────────────────────────────
  const fmtK = (n) => {
    if (!n && n !== 0) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return Math.round(n).toLocaleString();
  };
  const fmtSigned = (n) => n >= 0 ? `+${fmtK(n)}` : `−${fmtK(Math.abs(n))}`;
  const latestMc = D.marketCapChart?.at(-1)?.v ?? 0;
  ticker.push({ k: 'SUPPLY', v: fmtK(D.hero.supply) });
  ticker.push({ k: 'MC',     v: `$${fmtK(latestMc)}` });
  const median = (arr) => {
    if (!arr || !arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const inf = D.influenceFlow.totals;
  const infMinted = (inf.purchased || 0) + (inf.refunded || 0);
  const infConsumeRate = infMinted > 0 ? (inf.consumed / infMinted * 100).toFixed(1) + '%' : '—';
  const infRefundRate  = infMinted > 0 ? (inf.refunded  / infMinted * 100).toFixed(1) + '%' : '—';
  const lastInfDay     = D.influenceFlow.days.at(-1) || {};
  const infNetFlow24h  = (lastInfDay.purchased || 0) - (lastInfDay.consumed || 0);
  const infBurnImplied = lastInfDay.consumed || 0;

  const lastCycle   = D.usdmPerCycle.at(-1);
  const lastRecip   = D.recipientsPerCycle.at(-1);
  const medUsdm     = Math.round(median(D.usdmPerCycle.map(c => c.v)));
  const medRecip    = Math.round(median(D.recipientsPerCycle.map(c => c.v)));
  const medNewRecip = Math.round(median((D.newRecipientsPerCycle || []).map(c => c.v)));

  const idleCount    = Math.max(0, D.companies.totalCompanies - D.companies.activeTrades);
  const expiredCount = Math.max(0, idleCount - Math.round(idleCount * 0.6));
  const trueIdleCount = idleCount - expiredCount;

  const dawPct = D.dailyActiveWalletsPeak > 0
    ? Math.round((1 - counters.daw / D.dailyActiveWalletsPeak) * 100)
    : 0;

  // ── Right rail ─────────────────────────────────────────────────────────
  const rail = showRail ? (
    <WalletRail address={walletAddr} onAddressChange={setWalletAddr} ethPrice={counters.eth} newOps={latestNewOps} />
  ) : null;

  return (
    <TerminalShell
      mode="standalone"
      brand={{ name: 'OFFSHORE', sub: 'community dashboard · v0.3' }}
      nav={nav}
      apps={D.apps}
      activeAppId={activeApp}
      onAppChange={setActiveApp}
      ticker={ticker}
      search={search}
      onSearch={setSearch}
      sideFooter={sideFoot}
      rail={rail}
      sideContent={<LiveSidebar D={D} counters={counters} ops={ops} watch={watch} trades={liveTicker} onWallet={openWallet} aliases={aliases} />}
      railLabel="criminal"
      theme={theme}
      onThemeChange={onThemeChange}
      notifPrefs={notifs}
      onNotifChange={setNotifs}
      openRailRef={openRailRef}
      density={density}
    >
      <div className="tm-content">

        <section id="sec-overview" className="tm-grid-12">
        <div className="c-12">
          <div className="tm-stateline">
            <span className="prompt">&gt;</span>
            <span><span className="k">state ·</span> burn outpacing emission <b className="warn">{D.hero.burnedRatio}×</b></span>
            <span className="sep">·</span>
            <span><span className="k">total burned</span> <b className="neg">{D.hero.burnedAllTime} $dirty</b></span>
            <span className="sep">·</span>
            <span><span className="k">total inf bought</span> <b className="pos">{inf.purchased.toLocaleString()}</b></span>
            <span className="sep">·</span>
            <span><span className="k">daily active criminals</span> <b>{counters.daw.toLocaleString()}</b> <span className="k">{dawPct > 0 ? `(▾ ${dawPct}% from peak)` : '(at peak)'}</span></span>
            <span className="sep">·</span>
            <span><span className="k">world time</span> <b>{D.currentWorldTime || 'Q4 2012'}</b></span>
          </div>
        </div>


        </section>

        <section id="sec-token" className="tm-grid-12">
        <GridCell id="emissions" span={spans['emissions']} height={heights['emissions']} onResize={(r) => resizeCell('emissions', r)}>
          <Region
            title="emissions vs burn"
            sub={econGran}
            actions={<Seg value={econGran} options={['daily','hourly']} onChange={setEconGran} />}
          >
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={localDates(econGran === 'daily' ? (D.emissionsVsBurnDaily || D.emissionsVsBurn) : D.emissionsVsBurn, econGran === 'hourly')} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--t-rule)" vertical={false} />
                <XAxis dataKey="x" tick={CHART_AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={CHART_AXIS} axisLine={false} tickLine={false} tickFormatter={fmt.k} />
                <Tooltip content={<TmTooltip valueFmt={fmt.k} />} />
                <Bar dataKey="minted"       name="minted"   stackId="a" fill="var(--t-fg)"   maxBarSize={40} />
                <Bar dataKey="protocolMint" name="protocol" stackId="a" fill="var(--t-warn)" maxBarSize={40} />
                <Bar dataKey="spent"        name="spent"    fill="var(--t-neg)"              maxBarSize={40} radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 4, fontSize: 'var(--t-fs-sm)', color: 'var(--t-fg-soft)', display: 'flex', gap: 12, fontFamily: 'var(--t-font)' }}>
              <span><span style={{ color: 'var(--t-fg)' }}>█</span> minted</span>
              <span><span style={{ color: 'var(--t-warn)' }}>█</span> protocol</span>
              <span><span style={{ color: 'var(--t-neg)' }}>█</span> spent</span>
            </div>
          </Region>
        </GridCell>

        <GridCell id="burned" span={spans['burned']} height={heights['burned']} onResize={(r) => resizeCell('burned', r)}>
          <Region title="$dirty burned" sub="daily · all">
            <StackedBarRow
              hideNum
              data={localDates(D.burnedDaily)}
              series={[
                { key: 'protocolBurn', label: 'protocol burn',  color: 'neg',  colorVar: 'neg' },
                { key: 'asset',        label: 'asset purchase', color: 'fg',   colorVar: 'fg' },
                { key: 'levelUp',      label: 'level up',       color: 'hdr',  colorVar: 'hdr' },
                { key: 'thirdEnt',     label: 'third ent',      color: 'warn', colorVar: 'warn' },
              ]}
            />
            <div style={{ marginTop: 4, fontSize: 'var(--t-fs-sm)', color: 'var(--t-fg-soft)', display: 'flex', gap: 12, fontFamily: 'var(--t-font)' }}>
              <span><span style={{ color: 'var(--t-neg)' }}>█</span> protocol</span>
              <span><span style={{ color: 'var(--t-fg)' }}>█</span> asset</span>
              <span><span style={{ color: 'var(--t-hdr)' }}>█</span> level-up</span>
              <span><span style={{ color: 'var(--t-warn)' }}>█</span> 3rd enterprise</span>
            </div>
          </Region>
        </GridCell>
        <GridCell id="supply" span={spans['supply']} height={heights['supply']} onResize={(r) => resizeCell('supply', r)}>
          <Region title="$dirty valuation" sub="hourly · USDm">
            <LineChart
              data={localDates(D.marketCapChart || [], true)}
              color="warn"
              fill
              valueFmt={(v) => v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'k' : String(Math.round(v))}
              extraRows={(d) => d.price != null ? [{ k: 'price', v: `$${Number(d.price).toFixed(4)}` }] : []}
            />
          </Region>
        </GridCell>
        <GridCell id="company-state" span={spans['company-state']} height={heights['company-state']} onResize={(r) => resizeCell('company-state', r)}>
          <Region title="company state" sub={`${D.companies.totalCompanies.toLocaleString()} total`}>
            <StackedBarRow
              hideNum
              data={[
                { x: 'active',   manual: Math.max(0, D.companies.activeTrades - D.companies.autoTradeOn), auto: D.companies.autoTradeOn },
                { x: 'inactive', expired: expiredCount, idle: trueIdleCount },
              ]}
              series={[
                { key: 'manual',  color: 'pos',  label: 'active'  },
                { key: 'auto',    color: 'fg',   label: 'auto-on' },
                { key: 'expired', color: 'neg',  label: 'expired' },
                { key: 'idle',    color: 'warn', label: 'idle'    },
              ]}
              valueFmt={(v) => String(Math.round(v))}
            />
            <div style={{ marginTop: 4, fontSize: 'var(--t-fs-sm)', color: 'var(--t-fg-soft)', display: 'flex', gap: 12, fontFamily: 'var(--t-font)' }}>
              <span><span style={{ color: 'var(--t-pos)' }}>█</span> active</span>
              <span><span style={{ color: 'var(--t-fg)' }}>█</span> auto-on</span>
              <span><span style={{ color: 'var(--t-neg)' }}>█</span> expired</span>
              <span><span style={{ color: 'var(--t-warn)' }}>█</span> idle</span>
            </div>
            <KVSep />
            <KV k="active trades"  v={D.companies.activeTrades.toLocaleString()} cls="pos" />
            <KV k="auto-trade on"  v={D.companies.autoTradeOn.toLocaleString()} sub={D.companies.autoTradeShareLabel} />
            <KV k="unique owners"  v={D.companies.uniqueOwners.toLocaleString()} />
            {D.leaderboard && D.leaderboard[0] && <KV k="largest co" v={D.leaderboard[0].wallet} cls="dim" sub={`${D.leaderboard[0].ops.toLocaleString()} ops · ${D.leaderboard[0].earned} earned`} />}
          </Region>
        </GridCell>

        <GridCell id="circ-supply" span={spans['circ-supply']} onResize={(r) => resizeCell('circ-supply', r)}>
          <Region title="circulating supply" sub="hourly · $DIRTY">
            <LineChart
              data={localDates((D.marketCapChart || []).map(r => ({ ...r, v: r.supply })), true)}
              color="fg"
              fill
              valueFmt={(v) => v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(1)+'k' : String(Math.round(v))}
            />
          </Region>
        </GridCell>
        <GridCell id="dirty-price" span={spans['dirty-price']} onResize={(r) => resizeCell('dirty-price', r)}>
          <Region title="$dirty price" sub="hourly · USDm">
            {(() => {
              const prices = (D.marketCapChart || []).map(r => r.price).filter(Boolean);
              const dataMin = prices.length ? Math.min(...prices) : 0;
              const dataMax = prices.length ? Math.max(...prices) : 1;
              return (
                <LineChart
                  data={localDates((D.marketCapChart || []).map(r => ({ ...r, v: r.price })), true)}
                  color="pos"
                  fill
                  yMin={dataMin * 0.95}
                  yMax={dataMax}
                  valueFmt={(v) => '$' + Number(v).toFixed(4)}
                />
              );
            })()}
          </Region>
        </GridCell>
        <GridCell id="influence-totals" span={spans['influence-totals']} height={heights['influence-totals']} onResize={(r) => resizeCell('influence-totals', r)}>
          <Region title="influence flow" sub="all time">
            <KV k="purchased"   v={inf.purchased.toLocaleString()}   cls="pos" />
            <KV k="consumed"    v={inf.consumed.toLocaleString()}    cls="neg" />
            <KV k="refunded"    v={inf.refunded.toLocaleString()} />
            <KV k="circulating" v={inf.circulating.toLocaleString()} />
            <KVSep />
            <KV k="refund rate"        v={infRefundRate}  cls="warn" />
            <KV k="net flow / 24h"     v={fmtSigned(infNetFlow24h) + ' INF'} cls={infNetFlow24h >= 0 ? 'pos' : 'neg'} />
            <KV k="$INF burn implied"  v={fmtK(infBurnImplied)} />
          </Region>
        </GridCell>
        <GridCell id="influence-daily" span={spans['influence-daily']} height={heights['influence-daily']} onResize={(r) => resizeCell('influence-daily', r)}>
          <Region title="influence flow" sub={infGran === 'hourly' ? 'last 24h · hourly' : 'last 9d · daily'}
            actions={<Seg value={infGran} options={['daily','hourly']} onChange={setInfGran} />}
            fill
          >
            {(() => {
              const src = infGran === 'hourly' ? (D.influenceFlow.hours || []) : D.influenceFlow.days;
              return (
                <MultiSpark
                  labels={src.map(d => d.ts ? (infGran === 'hourly' ? fmtLocalHour(d.ts) : fmtLocal(d.ts)) : (d.x || ''))}
                  series={[
                    { label: 'purchased', color: 'var(--t-pos)', data: src.map(d => d.purchased || 0) },
                    { label: 'consumed',  color: 'var(--t-neg)', data: src.map(d => d.consumed  || 0) },
                    { label: 'refunded',  color: 'var(--t-fg)',  data: src.map(d => d.refunded  || 0) },
                  ]}
                />
              );
            })()}
          </Region>
        </GridCell>

        </section>

        <section id="sec-players" className="tm-grid-12">
        <GridCell id="heatmap" span={spans['heatmap']} height={heights['heatmap']} onResize={(r) => resizeCell('heatmap', r)}>
          <Region title="ops activity heatmap" sub="last 7d · local">
            <Heatmap grid={D.heatmap} days={D.heatmapDayTs ? D.heatmapDayTs.map(fmtLocal) : D.heatmapDays} />
          </Region>
        </GridCell>
        <GridCell id="daw" span={spans['daw']} onResize={(r) => resizeCell('daw', r)}>
          <Region title="daily active wallets" sub={`peak ${D.dailyActiveWalletsPeak.toLocaleString()}`}>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={participantsChart.map(d => ({ x: d.x, v: d.daw }))} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--t-rule)" vertical={false} />
                <XAxis dataKey="x" tick={CHART_AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={CHART_AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => String(Math.round(v))} />
                <Tooltip content={<TmTooltip valueFmt={(v) => String(Math.round(v))} />} />
                <Bar dataKey="v" name="active wallets" fill="var(--t-fg)" maxBarSize={40} radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Region>
        </GridCell>
        <GridCell id="total-players" span={spans['total-players']} onResize={(r) => resizeCell('total-players', r)}>
          <Region title="total players" sub={`${D.newParticipantsTotal.toLocaleString()} all time`}>
            <LineChart
              data={(D.totalPlayersChart || []).map(r => ({ x: r.x, v: r.v }))}
              color="pos"
              fill
              valueFmt={(v) => v >= 1000 ? (v/1000).toFixed(1)+'k' : String(Math.round(v))}
            />
          </Region>
        </GridCell>

        </section>

        <section id="sec-vault" className="tm-grid-12">
        <GridCell id="vault" span={spans['vault']} height={heights['vault']} onResize={(r) => resizeCell('vault', r)}>
          <Region title="swiss vault distribution" sub="cycles">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14, alignItems: 'flex-start' }}>
              <div>
                <KV k="total distributed" v={`${D.distributionTotals.totalLabel} USDm`} cls="hdr" />
                <KV k="cycles paid" v={String(D.distributionTotals.cyclesPaid)} />
                <KV k="unique recipients" v={D.distributionTotals.uniqueRecipients.toLocaleString()} />
                {lastCycle && <KV k="last cycle" v={`${fmtK(lastCycle.v)} USDm`} sub={`${lastRecip ? lastRecip.v : '—'} recipients · ${lastCycle.t}`} />}
                <KVSep />
                <KV k="median per cycle"     v={`${fmtK(medUsdm)} USDm`} />
                <KV k="new recipients / cycle" v={medNewRecip ? `~${medNewRecip}` : '—'} cls="dim" />
              </div>
              <div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={D.usdmPerCycle.map((d) => ({ label: d.t, usdm: d.v }))} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--t-rule)" vertical={false} />
                    <XAxis dataKey="label" tick={CHART_AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={CHART_AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? Math.round(v/1000)+'k' : String(Math.round(v))} />
                    <Tooltip content={<TmTooltip valueFmt={(v) => v >= 1000 ? (v/1000).toFixed(2)+'k' : String(Math.round(v))} />} />
                    <Bar dataKey="usdm" name="USDm" fill="var(--t-hdr)" maxBarSize={40} radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Region>
        </GridCell>
        <GridCell id="top-stakers" span={spans['top-stakers']} onResize={(r) => resizeCell('top-stakers', r)}>
          <Region title={`all stakers${stakingData?.stats?.uniqueStakers ? ` · ${stakingData.stats.uniqueStakers.toLocaleString()} total` : ''}`} sub="by $dirty staked">
            {!stakingData?.top24h?.length ? (
              <span className="dim">no staking activity in the last 24h</span>
            ) : (
              <div className="tm-scroll-bl" style={{ maxHeight: 264, overflowY: 'auto' }}>
                <table className="tm-tab tm-tab-bl">
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                    <tr>
                      <th>#</th>
                      <th>wallet</th>
                      <th className="num">$dirty staked</th>
                      <th className="num">deposits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stakingData.top24h.map((s, i) => (
                      <tr key={s.user}>
                        <td className="dim">{i + 1}</td>
                        <td>
                          <span className="tm-num" style={{ cursor: 'pointer', color: 'var(--t-hdr)' }} onClick={() => openWallet(s.user)}>
                            {s.alias || aliases[s.user] || `${s.user.slice(0, 6)}..${s.user.slice(-4)}`}
                          </span>
                        </td>
                        <td className="num pos">{s.total >= 1000 ? (s.total / 1000).toFixed(1) + 'k' : s.total.toLocaleString()}</td>
                        <td className="num">{s.deposits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Region>
        </GridCell>
        <GridCell id="staking-chart" span={spans['staking-chart']} onResize={(r) => resizeCell('staking-chart', r)}>
          <Region
            title="faction staking"
            sub={stakingData?.stats
              ? `${(stakingData.stats.totalStaked / 1e3).toFixed(1)}k $dirty staked · ${stakingData.stats.uniqueStakers} stakers · rotation ${stakingData.stats.currentRotation}`
              : 'loading…'}
            fill
          >
            {stakingData?.dailyChart?.length > 0 ? (
              <LineChart
                data={stakingData.dailyChart.map(d => ({ x: d.label, v: d.total }))}
                color="pos"
                fill
                valueFmt={(v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v))}
              />
            ) : (
              <span className="dim">no data</span>
            )}
          </Region>
        </GridCell>

        </section>

        <section id="sec-trades" className="tm-grid-12">
        <GridCell id="trades" span={spans['trades']} height={heights['trades']} onResize={(r) => resizeCell('trades', r)}>
          <Region
            title="ongoing crimes"

            focus={focusPane === 'trades'}
            actions={<Seg value={trxRange} options={['all','active','auto']} onChange={setTrxRange} />}
          >
            <div className="tm-scroll-bl" style={{ maxHeight: 264, overflowY: 'auto', overflowX: 'hidden' }}>
              <table className="tm-tab tm-tab-bl" style={{ tableLayout: 'fixed', width: '100%' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                  <tr>
                    <th style={{ width: 100, maxWidth: 100 }}><Sortable label="criminal" k="id"       sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th style={{ width: 72 }}><Sortable label="crime"   k="opType"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th style={{ width: 60 }}><Sortable label="ends"    k="endsIn"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th className="num" style={{ width: 52 }}><Sortable label="buffer"  k="buffer"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th className="num" style={{ width: 80 }}><Sortable label="busted price" k="liqPrice" sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th style={{ width: 40 }}><Sortable label="auto"     k="auto"     sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>

                  </tr>
                </thead>
                <tbody>
                  {renderTradeRows(tradesFiltered, trxRange, counters.eth, tick, openWallet, aliases)}
                </tbody>
              </table>
            </div>
          </Region>
        </GridCell>
        <GridCell id="ops" span={spans['ops']} height={heights['ops']} onResize={(r) => resizeCell('ops', r)}>
          <Region title="finished crimes" sub="live · last 250" focus={focusPane === 'ops'}>
            <div className="tm-scroll-bl" style={{ maxHeight: 264, overflowY: 'auto' }}>
              <table className="tm-tab tm-tab-bl">
                <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                  <tr>
                    <th>t</th>
                    <th>criminal</th>
                    <th>operation</th>
                    <th className="num">$dirty</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map((o, i) => {
                    const success = o.result === 'completed' || o.result === 'ok';
                    const fail    = o.result === 'busted'    || o.result === 'fail';
                    return (
                    <tr key={i}>
                      <td className="dim">{o.time}</td>
                      <td><span className="tm-num" style={{ cursor: 'pointer', color: 'var(--t-hdr)' }} onClick={() => openWallet(o.walletFull || o.wallet)}>{aliases[o.walletFull] || o.wallet}</span></td>
                      <td className={success ? 'pos' : fail ? 'neg' : ''}>{o.op}</td>
                      <td className={`num ${o.dirty > 0 ? 'pos' : o.dirty < 0 ? 'neg' : ''}`}>
                        {fmt.signed(o.dirty)}{o.count > 1 && <span className="dim" style={{ marginLeft: 4, fontSize: 'var(--t-fs-xs)' }}>{o.count}×</span>}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Region>
        </GridCell>

        </section>


      </div>

      {showToasts && <Toasts items={filteredTicker} />}
    </TerminalShell>
  );
}

