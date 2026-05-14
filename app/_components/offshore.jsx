'use client';
import { useState as useStateO, useMemo as useMemoO, useRef as useRefO, useEffect as useEffectO } from 'react';
import {
  TerminalShell, Region, Stats, KV, KVSep, BarRow, BarRow2, StackedBarRow,
  BlockRow, Spark, MultiSpark, Heatmap, AsciiBarChart, LineChart, Seg, Sortable, GridCell, Toasts, fmt,
} from './terminal.jsx';

function InfTooltip({ data, current, trend }) {
  const W = 260, H = 90;
  const PAD = { l: 36, r: 8, t: 8, b: 18 };
  const pw = W - PAD.l - PAD.r;
  const ph = H - PAD.t - PAD.b;
  const hasData = data && data.length >= 2;

  const min = hasData ? Math.min(...data.map(d => d.v)) : 0;
  const max = hasData ? Math.max(...data.map(d => d.v)) : 1;
  const rng = max - min || 1;
  const t0  = hasData ? data[0].t : 0;
  const t1  = hasData ? data[data.length - 1].t : 1;
  const trng = t1 - t0 || 1;

  const pts = hasData ? data.map(d => [
    PAD.l + ((d.t - t0) / trng) * pw,
    PAD.t + ph - ((d.v - min) / rng) * ph,
  ]) : [];

  const line = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const area = pts.length > 1
    ? `${line} L${pts[pts.length-1][0]},${PAD.t+ph} L${pts[0][0]},${PAD.t+ph}Z`
    : '';

  const xLabels = hasData ? (() => {
    const step = Math.max(1, Math.floor(data.length / 4));
    return [0, step, step * 2, step * 3, data.length - 1]
      .filter((v, i, a) => v < data.length && a.indexOf(v) === i)
      .map(i => ({
        x: PAD.l + ((data[i].t - t0) / trng) * pw,
        label: new Date(data[i].t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
  })() : [];

  const ax = { fill: 'var(--t-fg-soft)', fontSize: 9, fontFamily: 'var(--t-font)', fontWeight: 400 };

  return (
    <div style={{
      background: 'var(--t-bg)', border: '1px solid var(--t-rule-hot)',
      padding: '8px 10px', width: W + 20,
      fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs-sm)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
        <span style={{ color: 'var(--t-fg-mut)', fontSize: 'var(--t-fs-xs)', letterSpacing: '0.08em' }}>OP COST</span>
        <span style={{ color: 'var(--t-num)', fontWeight: 500 }}>{current.toFixed(2)} INF</span>
      </div>
      {trend != null && (
        <div style={{ color: trend >= 0 ? 'var(--t-pos)' : 'var(--t-neg)', fontSize: 'var(--t-fs-xs)', marginBottom: 6 }}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(2)}% vs 24h ago
        </div>
      )}
      {!hasData ? (
        <div style={{ color: 'var(--t-fg-mut)', fontSize: 'var(--t-fs-xs)', padding: '10px 0 4px' }}>collecting history…</div>
      ) : (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', fontFamily: 'var(--t-font)', fontWeight: 400 }}>
          <path d={area} fill="var(--t-fg)" opacity="0.1" />
          <path d={line} fill="none" stroke="var(--t-fg)" strokeWidth="1.5" />
          <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="3" fill="var(--t-fg)" />
          <line x1={PAD.l} x2={W-PAD.r} y1={PAD.t+ph} y2={PAD.t+ph} stroke="var(--t-rule)" strokeWidth="0.5" />
          <text x={PAD.l-3} y={PAD.t+4} textAnchor="end" {...ax}>{max.toFixed(2)}</text>
          <text x={PAD.l-3} y={PAD.t+ph+3} textAnchor="end" {...ax}>{min.toFixed(2)}</text>
          {xLabels.map((l, i) => (
            <text key={i} x={l.x} y={H-3} textAnchor="middle" {...ax}>{l.label}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

export function OffshoreDashboard({ D, showToasts = true, showRail = true, theme = 'purple', density = 'regular', onThemeChange }) {
  // ── State ──────────────────────────────────────────────────────────────
  const [activeApp, setActiveApp] = useStateO('offshore');
  const [tab, setTab] = useStateO('dashboard');
  const [search, setSearch] = useStateO('');

  const cellPairs = {
    'emissions':         'burned',
    'burned':            'emissions',
    'influence-totals':  'influence-daily',
    'influence-daily':   'influence-totals',
    'trades':            'ops',
    'ops':               'trades',
    'heatmap':           'participants',
    'participants':      'heatmap',
    'supply':            'company-state',
    'company-state':     'supply',
  };
  const [spans, setSpans] = useStateO({
    'emissions':          7,
    'burned':             5,
    'supply':             7,
    'influence-totals':   5,
    'influence-daily':    7,
    'heatmap':            5,
    'participants':        7,
    'vault':             12,
    'trades':             7,
    'ops':                5,
    'leaderboard':       12,
    'company-state':      5,
  });
  const [heights, setHeights] = useStateO({ supply: 360, 'influence-daily': 200 });

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
  const [econGran, setEconGran]  = useStateO('hourly');
  const [supplyGran, setSupplyGran] = useStateO('daily');
  const [infGran, setInfGran]    = useStateO('daily');
  const [notifs, setNotifs] = useStateO({ 'buys & sells': true, 'operations': true });
  const [burnRange, setBurnRange] = useStateO('all');
  const [trxRange, setTrxRange] = useStateO('all');
  const [sortKey, setSortKey] = useStateO('endsIn');
  const [sortDir, setSortDir] = useStateO('asc');
  const [focusPane, setFocusPane] = useStateO('trades');

  // ── Live ops feed ────────────────────────────────────────────────────
  const [ops, setOps] = useStateO(() =>
    (D.recentOps && D.recentOps.length > 0)
      ? D.recentOps.slice(0, 250).map(o => ({ ...o, time: nowHMS() }))
      : []
  );
  const lastOpTsRef = useRefO(
    (D.recentOps && D.recentOps.length > 0) ? (D.recentOps[0]._ts || 0) : 0
  );

  // ── Filter / sort trades ──────────────────────────────────────────────
  const tradesFiltered = useMemoO(() => {
    let arr = D.liveTrades;
    if (search) arr = arr.filter((r) => r.id.toLowerCase().includes(search.toLowerCase()));
    arr = [...arr];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const x = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? x : -x;
    });
    return arr;
  }, [search, sortKey, sortDir, D]);

  const underwaterCount = D.liveTrades.filter((r) => r.buffer < 0).length;

  const participantsChart = useMemoO(() => {
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
    { id: 'overview',    label: 'overview',    fkey: 'F1' },
    { id: 'token',       label: 'token',       fkey: 'F2' },
    { id: 'players',     label: 'players',     fkey: 'F3' },
    { id: 'vault',       label: 'vault',       fkey: 'F4' },
    { id: 'trades',      label: 'trades',      fkey: 'F5' },
    { id: 'leaderboard', label: 'leaderboard', fkey: 'F7' },
  ];

  // ── Live counters + event ticker ─────────────────────────────────────
  const ci = D.counterInit || {};
  const [counters, setCounters] = useStateO(() => ({
    block:  ci.block  || 4128907,
    daw:    ci.daw    || 930,
    opsMin: ci.opsMin || 4.2,
    dirty:  ci.dirty  || 0.0706,
    opCost: ci.opCost || 12.41,
    gas:    ci.gas    || 0.001,
    eth:    D.liveTrades[0]?.ethPrice ?? 0,
    tps:    0,
    _bump: 0,
  }));
  const [liveTicker, setLiveTicker] = useStateO(() => D.liveTradeTicker || []);
  const filteredTicker = useMemoO(() => liveTicker.filter(item => {
    if ((item.kind === 'buy' || item.kind === 'sell') && !notifs['buys & sells']) return false;
    if (item.kind === 'op' && !notifs['operations']) return false;
    return true;
  }), [liveTicker, notifs]);
  useEffectO(() => {
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
          eth:    d.eth    ?? c.eth,
          tps:    d.tps    ?? c.tps,
          _bump:  c._bump + 1,
        }));
        if (d.newOps && d.newOps.length > 0) {
          const ts = nowHMS();
          lastOpTsRef.current = d.newOps[d.newOps.length - 1]._ts;
          setOps((prev) => [...d.newOps.map(o => ({ ...o, time: ts })).reverse(), ...prev].slice(0, 250));
        }
        if (d.latestEvent && d.latestEvent._ts > lastEventTs) {
          lastEventTs = d.latestEvent._ts;
          setLiveTicker((prev) => [d.latestEvent, ...prev].slice(0, 60));
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
    const t = setInterval(tick, 2200);
    return () => { live = false; clearInterval(t); };
  }, []);

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

  const fkeys = [
    { k: 'F1', label: 'help' },
    { k: 'F2', label: 'token' },
    { k: 'F3', label: 'players' },
    { k: 'F4', label: 'vault' },
    { k: 'F5', label: 'trades' },
    { k: 'F6', label: 'ops' },
    { k: 'F7', label: 'leaderboard' },
    { k: 'F8', label: 'wallet' },
    { k: '/',  label: 'search' },
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
    <WalletRail D={D} address={search || D.wallet.address} />
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
      fkeys={fkeys}
      sideFooter={sideFoot}
      rail={rail}
      sideContent={<LiveSidebar D={D} counters={counters} ops={ops} />}
      railLabel="wallet"
      theme={theme}
      onThemeChange={onThemeChange}
      notifPrefs={notifs}
      onNotifChange={setNotifs}
      density={density}
    >
      <div className="tm-content">

        <section id="sec-overview" className="tm-grid-12">
        <div className="c-12">
          <div className="tm-stateline">
            <span className="prompt">&gt;</span>
            <span><span className="k">state ·</span> burn outpacing emission <b className="warn">{D.hero.burnedRatio}×</b></span>
            <span className="sep">·</span>
            <span><span className="k">net flow / 24h</span> <b className="neg">{fmtSigned(infNetFlow24h)} INF</b></span>
            <span className="sep">·</span>
            <span><span className="k">at risk</span> <b className="neg">{underwaterCount} cos underwater</b></span>
            <span className="sep">·</span>
            <span><span className="k">vault paid</span> <b className="pos">{D.distributionTotals.totalLabel} USDm</b></span>
            <span className="sep">·</span>
            <span><span className="k">daw</span> <b>{counters.daw.toLocaleString()}</b> <span className="k">{dawPct > 0 ? `(▾ ${dawPct}% from peak)` : '(at peak)'}</span></span>
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
            fkey="F2"
            actions={<Seg value={econGran} options={['daily','hourly']} onChange={setEconGran} />}
          >
            <AsciiBarChart
              data={localDates(econGran === 'daily' ? (D.emissionsVsBurnDaily || D.emissionsVsBurn) : D.emissionsVsBurn, econGran === 'hourly')}
              series={[
                { key: 'minted',       color: 'fg'   },
                { key: 'protocolMint', color: 'warn', stackOn: 'minted' },
                { key: 'spent',        color: 'neg'  },
              ]}
              height={14}
              valueFmt={fmt.k}
            />
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
          <Region title="$dirty valuation" sub="hourly · USDm" fkey="F2">
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
          <Region title="company state" sub={`${D.companies.totalCompanies.toLocaleString()} total`} fkey="F5">
            <StackedBarRow
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

        <GridCell id="influence-totals" span={spans['influence-totals']} height={heights['influence-totals']} onResize={(r) => resizeCell('influence-totals', r)}>
          <Region title="influence flow" sub="all time" fkey="F2">
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
          <Region title="influence flow" sub={infGran === 'hourly' ? 'last 24h · hourly' : 'last 9d · daily'} fkey="F2"
            actions={<Seg value={infGran} options={['daily','hourly']} onChange={setInfGran} />}
            fill
          >
            {(() => {
              const src = infGran === 'hourly'
                ? (D.influenceFlow.hours || [])
                : D.influenceFlow.days;
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
          <Region title="ops activity heatmap" sub="last 7d · local" fkey="F3">
            <Heatmap grid={D.heatmap} days={D.heatmapDayTs ? D.heatmapDayTs.map(fmtLocal) : D.heatmapDays} />
          </Region>
        </GridCell>
        <GridCell id="participants" span={spans['participants']} height={heights['participants']} onResize={(r) => resizeCell('participants', r)}>
          <Region title="daily active wallets · total players" sub={`peak daw ${D.dailyActiveWalletsPeak.toLocaleString()} · ${D.newParticipantsTotal.toLocaleString()} players all time`} fkey="F3">
            <BarRow2
              data={participantsChart}
              series={[
                { key: 'daw',     label: 'daily active wallets', color: 'fg',  dir: 'rtl' },
                { key: 'players', label: 'total players',        color: 'pos' },
              ]}
              valueFmt={(v) => v == null ? '—' : String(Math.round(v))}
            />
          </Region>
        </GridCell>

        </section>

        <section id="sec-vault" className="tm-grid-12">
        <GridCell id="vault" span={spans['vault']} height={heights['vault']} onResize={(r) => resizeCell('vault', r)}>
          <Region title="swiss vault distribution" sub="cycles" fkey="F4">
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
                <AsciiBarChart
                  data={D.usdmPerCycle.map((d) => ({ label: d.t, usdm: d.v }))}
                  series={[{ key: 'usdm', color: 'hdr' }]}
                  height={14}
                  valueFmt={(v) => v >= 1000 ? Math.round(v / 1000) + 'k' : String(Math.round(v))}
                />
              </div>
            </div>
          </Region>
        </GridCell>

        </section>

        <section id="sec-trades" className="tm-grid-12">
        <GridCell id="trades" span={spans['trades']} height={heights['trades']} onResize={(r) => resizeCell('trades', r)}>
          <Region
            title="ongoing crimes"
            sub={`${tradesFiltered.length} co · grouped · sortable`}
            fkey="F5"
            focus={focusPane === 'trades'}
            actions={<Seg value={trxRange} options={['all','active','auto']} onChange={setTrxRange} />}
          >
            <div className="tm-scroll-bl" style={{ maxHeight: 264, overflowY: 'auto', overflowX: 'hidden' }}>
              <table className="tm-tab tm-tab-bl">
                <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                  <tr>
                    <th><Sortable label="company" k="id"       sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th><Sortable label="auto"    k="auto"     sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th><Sortable label="ends"    k="endsIn"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th className="num"><Sortable label="liq px"  k="liqPrice" sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th className="num"><Sortable label="buffer" k="buffer"   sortKey={sortKey} sortDir={sortDir} on={sortBy} /></th>
                    <th>history</th>
                    <th className="num">entry</th>
                  </tr>
                </thead>
                <tbody>
                  {renderTradeRows(tradesFiltered, trxRange)}
                </tbody>
              </table>
            </div>
          </Region>
        </GridCell>
        <GridCell id="ops" span={spans['ops']} height={heights['ops']} onResize={(r) => resizeCell('ops', r)}>
          <Region title="live criminal activity" sub="live · last 250" fkey="F6" focus={focusPane === 'ops'}>
            <div className="tm-scroll-bl" style={{ maxHeight: 264, overflowY: 'auto' }}>
              <table className="tm-tab tm-tab-bl">
                <thead style={{ position: 'sticky', top: 0, background: 'var(--t-bg)', zIndex: 1 }}>
                  <tr>
                    <th>t</th>
                    <th>wallet</th>
                    <th>op</th>
                    <th>res</th>
                    <th className="num">$dirty</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map((o, i) => (
                    <tr key={i}>
                      <td className="dim">{o.time}</td>
                      <td><span className="tm-num">{o.wallet}</span></td>
                      <td>{o.op}</td>
                      <td className={o.result === 'completed' || o.result === 'ok' ? 'pos' : o.result === 'busted' || o.result === 'fail' ? 'neg' : 'dim'}>{o.result}</td>
                      <td className={`num ${o.dirty > 0 ? 'pos' : o.dirty < 0 ? 'neg' : ''}`}>{fmt.signed(o.dirty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Region>
        </GridCell>

        </section>

        <section id="sec-leaderboard" className="tm-grid-12">
        <GridCell id="leaderboard" span={spans['leaderboard']} height={heights['leaderboard']} onResize={(r) => resizeCell('leaderboard', r)}>
          <Region title="top criminals" sub="all time · rank Δ vs yesterday" fkey="F7">
            <table className="tm-tab">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Δ</th>
                  <th>wallet</th>
                  <th>tier</th>
                  <th className="num">ops</th>
                  <th className="num">$dirty</th>
                  <th className="num">net</th>
                  <th>trend</th>
                </tr>
              </thead>
              <tbody>
                {(D.leaderboard || LEADERBOARD).map((r, i) => {
                  const dot = r.rank > 0 ? `▲ +${r.rank}` : r.rank < 0 ? `▾ ${r.rank}` : '─';
                  const dotCls = r.rank > 0 ? 'pos' : r.rank < 0 ? 'neg' : 'dim';
                  return (
                    <tr key={r.wallet} className={r.wallet === (search || D.wallet.address) ? 'sel' : ''}>
                      <td className="dim">{String(i + 1).padStart(2, '0')}</td>
                      <td className={dotCls}>{dot}</td>
                      <td><span className="tm-num">{r.wallet}</span></td>
                      <td className="dim">{TIERS[i] || 'caribbean'}</td>
                      <td className="num">{r.ops.toLocaleString()}</td>
                      <td className="num pos">{r.earned}</td>
                      <td className={`num ${r.net.startsWith('+') ? 'pos' : 'neg'}`}>{r.net}</td>
                      <td><Spark data={r.spark} color={r.net.startsWith('+') ? 'var(--t-pos)' : 'var(--t-neg)'} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Region>
        </GridCell>

        </section>

      </div>

      {showToasts && <Toasts items={filteredTicker} />}
    </TerminalShell>
  );
}

// ── Live sidebar ───────────────────────────────────────────────────────────
function LiveSidebar({ D, counters, ops }) {
  const watch = useMemoO(() => {
    return D.liveTrades
      .filter((r) => r.active || r.buffer < 5)
      .slice()
      .sort((a, b) => a.buffer - b.buffer)
      .slice(0, 5);
  }, [D]);

  return (
    <div className="tm-live">
      <div className="tm-live-panel">
        <div className="tm-live-panel-h">
          <span><b>live</b> counters</span>
          <span className="rule" />
          <span className="v"><span className="tm-blink" style={{ color: 'var(--t-pos)' }}>●</span></span>
        </div>
        <Counter k="d. active players" v={counters.daw.toLocaleString()} />
        <Counter k="total players"    v={D.newParticipantsTotal.toLocaleString()} />
        <Counter k="ops/min"    v={Math.round(counters.opsMin).toLocaleString()}  tickKey={counters._bump} />
        <Counter k="ops/hour"   v={Math.round(counters.opsMin * 60).toLocaleString()}               tickKey={counters._bump} />
        <Counter k="$dirty"     v={`$${counters.dirty.toFixed(4)}`} cls="warn"   tickKey={counters._bump} />
        <Counter k="op cost"    v={`${counters.opCost.toFixed(2)} INF`}          tickKey={counters._bump} />
      </div>

      <div className="tm-live-panel">
        <div className="tm-live-panel-h">
          <span><b>watch</b> imminent</span>
          <span className="rule" />
          <span className="v">{watch.filter((r) => r.buffer < 0).length} of {watch.length}</span>
        </div>
        {watch.map((r) => {
          const underwater = r.buffer < 0;
          const urgent = r.active && r.endsIn !== '—' && r.endsIn.length <= 5;
          const cls = underwater ? 'underwater' : urgent ? 'urgent' : 'safe';
          return (
            <div key={r.id} className={`tm-watch ${cls}`}>
              <span className="l">
                <span className="id">{r.id}</span>
                <span className="sub">liq {r.liqPrice.toLocaleString()}</span>
              </span>
              <span className="r">
                <span className={`buf ${r.buffer >= 0 ? 'tm-pos' : 'tm-neg'}`}>{r.buffer >= 0 ? '+' : ''}{r.buffer.toFixed(2)}</span>
                <span className="ends">{r.active ? r.endsIn : 'idle'}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="tm-live-panel">
        <div className="tm-live-panel-h">
          <span><b>ops</b> feed</span>
          <span className="rule" />
          <span className="v">live</span>
        </div>
        <div className="tm-opfeed">
          {ops.slice(0, 6).map((o, i) => {
            const fadeCls = i >= 3 ? `fade${i >= 5 ? '-3' : i >= 4 ? '-2' : ''}` : '';
            return (
              <div key={`${o.time}-${i}`} className={`tm-opfeed-row ${fadeCls}`}>
                <span className="l">
                  <span className="t">{o.time.slice(0, 5)}</span>
                  <span className="a">{o.wallet}</span>
                  <span className="op">· {o.op}</span>
                </span>
                <span className={`v ${o.dirty > 0 ? 'pos' : o.dirty < 0 ? 'neg' : 'dim'}`}>{fmt.signed(o.dirty)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Counter({ k, v, cls, tickKey }) {
  const [last, setLast] = useStateO(tickKey);
  const [pulse, setPulse] = useStateO(false);
  useEffectO(() => {
    if (tickKey !== last) {
      setPulse(true);
      setLast(tickKey);
      const t = setTimeout(() => setPulse(false), 600);
      return () => clearTimeout(t);
    }
  }, [tickKey, last]);
  return (
    <div className="tm-live-counter">
      <span className="k">{k}</span>
      <span className={`v ${cls || ''} ${pulse ? 'tick' : ''}`}>{v}</span>
    </div>
  );
}

// ── Wallet rail ────────────────────────────────────────────────────────────
function WalletRail({ D, address }) {
  const w = D.wallet;
  const isOwner = address === w.address;
  return (
    <>
      <div className="tm-rail-h">wallet <em>{isOwner ? '· connected' : '· inspected'}</em></div>
      <div className="tm-rail-addr">
        <span className="tm-hot">{address}</span>
        <span className="x" title="clear">×</span>
      </div>
      <Region title="indexed stats" fkey="F8">
        <KV k="total ops"    v={w.indexed.totalOps} />
        <KV k="dirty earned" v={w.indexed.dirtyEarned}  cls="pos" />
        <KV k="dirty spent"  v={w.indexed.dirtySpent}   cls="neg" />
        <KV k="balance"      v={w.indexed.balance} />
        <KVSep />
        <KV k="inf bought"   v={w.indexed.infBought.toLocaleString()} sub={`${w.indexed.infBoughtPurchases} purchases`} />
        <KV k="inf refunded" v={w.indexed.infRefunded.toLocaleString()} />
        <KV k="dex bought"   v={w.indexed.dexBought} sub={`${w.indexed.dexBoughtTxs} txs`} />
        <KV k="dex sold"     v={w.indexed.dexSold}   sub={`${w.indexed.dexSoldTxs} txs`} cls="neg" />
        <KVSep />
        <KV k="vault claimed" v={w.indexed.vaultClaimed} cls="hdr" sub={`${w.indexed.vaultPayouts} payouts`} />
      </Region>

      <Region title="earned by op" fkey="F8">
        {w.earnedByOp.map((r) => (
          <div className="tm-barrow" key={r.type}>
            <span className="lbl">{r.type.toLowerCase()}</span>
            <span className="tm-track">
              <i style={{ width: `${r.share}%`, background: `var(--t-${r.color === 'green' ? 'pos' : r.color === 'orange' ? 'fg' : 'neg'})` }} />
            </span>
            <span className="num">{r.dirty}</span>
          </div>
        ))}
      </Region>

      <Region title="how spent" fkey="F8">
        {w.spent.map((r) => (
          <div className="tm-barrow" key={r.type}>
            <span className="lbl">{r.type.toLowerCase()}</span>
            <span className="tm-track">
              <i style={{ width: `${r.share == null ? 50 : r.share}%`, background: `var(--t-${r.color === 'orange' ? 'fg' : r.color === 'magenta' ? 'hdr' : 'neg'})` }} />
            </span>
            <span className="num">{r.dirty}</span>
          </div>
        ))}
      </Region>

      <Region title="farmed daily" fkey="F8">
        <BarRow2
          data={localDates(w.farmedDaily)}
          series={[
            { key: 'earned', label: 'earned', color: 'pos' },
            { key: 'spent',  label: 'spent',  color: 'neg' },
          ]}
        />
      </Region>
    </>
  );
}

const TIERS = [
  'shanghai', 'panama', 'monaco', 'zurich', 'cayman',
  'panama', 'caribbean', 'caribbean', 'caribbean', 'caribbean',
];

const LEADERBOARD = [
  { wallet: '0xa14e…03ab', ops: 1842, earned: '92.4k', net: '+74.2k', rank: 2,   spark: [22, 28, 26, 31, 36, 40, 38, 45, 50, 58, 62, 64] },
  { wallet: '0x77be…5ee2', ops: 1601, earned: '78.1k', net: '+61.8k', rank: -1,  spark: [18, 22, 25, 29, 32, 38, 41, 44, 47, 52, 55, 58] },
  { wallet: '0x39b5…f637', ops: 1423, earned: '64.0k', net: '+45.2k', rank: 0,   spark: [16, 19, 21, 24, 28, 32, 35, 38, 40, 42, 44, 46] },
  { wallet: '0x4d2c…aa11', ops: 1108, earned: '52.3k', net: '+38.1k', rank: 4,   spark: [14, 16, 18, 22, 26, 28, 31, 32, 34, 36, 38, 40] },
  { wallet: '0x6883…8806', ops: 998,  earned: '46.8k', net: '+34.0k', rank: -2,  spark: [12, 14, 17, 20, 22, 24, 26, 28, 30, 31, 33, 35] },
];

// ── Trade table helpers ────────────────────────────────────────────────────
function renderTradeRows(rows, range) {
  const filtered = range === 'active' ? rows.filter((r) => r.active)
                 : range === 'auto'   ? rows.filter((r) => r.auto)
                 : rows;
  const active = filtered.filter((r) => r.active);
  const idle   = filtered.filter((r) => !r.active);

  const groups = [];
  if (active.length) groups.push({ label: 'active · time-pressured', rows: active, color: 'pos' });
  if (idle.length)   groups.push({ label: 'idle · no expiry', rows: idle, color: 'dim' });

  return groups.flatMap((g, gi) => [
    <tr className="tm-tab-group" key={`g-${gi}`}>
      <td colSpan={7}>
        <span className="label">─ {g.label}</span> <span className="count">({g.rows.length})</span>
        <span className="rule" />
      </td>
    </tr>,
    ...g.rows.slice(0, 10).map((r) => {
      const history = bufferHistory(r);
      const underwater = r.buffer < 0;
      return (
        <tr key={r.id} className={underwater ? 'underwater' : ''}>
          <td><span className="tm-num">{r.id}</span></td>
          <td><span className={`tm-pill ${r.auto ? 'on' : 'off'}`}>{r.auto ? 'on' : 'off'}</span></td>
          <td className={r.active ? 'warn' : 'dim'}>{r.endsIn}</td>
          <td className="num">{r.liqPrice.toLocaleString()}</td>
          <td className={`num ${r.buffer >= 0 ? 'pos' : 'neg'}`}>{r.buffer >= 0 ? '+' : ''}{r.buffer.toFixed(2)}</td>
          <td><Spark data={history} w={60} h={16} color={`var(--t-${r.buffer >= 0 ? 'pos' : 'neg'})`} /></td>
          <td className="num dim">{r.entry != null ? `$${r.entry.toFixed(2)}` : '—'}</td>
        </tr>
      );
    }),
  ]);
}

function bufferHistory(r) {
  let seed = 0;
  for (const ch of r.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296);
  };
  const target = r.buffer;
  const start = target + (rng() * 30 + 10) * (target >= 0 ? -1 : 1);
  const out = [];
  let v = start;
  for (let i = 0; i < 12; i++) {
    const blend = i / 11;
    const noise = (rng() - 0.5) * 8;
    v = start * (1 - blend) + target * blend + noise;
    out.push(v);
  }
  out[out.length - 1] = target;
  return out;
}

function nowHMS() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

function fmtLocal(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtLocalHour(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}h`;
}

function localDates(arr, hourly = false) {
  if (!arr || !arr.length) return arr;
  return arr.map(d => {
    if (d.ts == null) return d;
    const lbl = hourly ? fmtLocalHour(d.ts) : fmtLocal(d.ts);
    return { ...d, x: lbl, label: lbl };
  });
}
