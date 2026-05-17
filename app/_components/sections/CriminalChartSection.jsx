'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Region, GridCell } from '../terminal.jsx';

// Live SVG chart of ETH price with the selected wallet's active-op liq-price
// horizontal markers and op-end vertical markers. Visible only when a wallet
// is loaded into the criminal rail.
//
// Axes:  X = time (past → future, "now" centred-ish); Y = ETH price (auto-scaled)
// Wheel = zoom (5m ↔ 2h total span). Drag = pan in time.

const SPAN_MIN = 5 * 60;          // 5 minutes
const SPAN_MAX = 2 * 60 * 60;     // 2 hours
// In auto mode the right edge of the chart sits a bit past the furthest active
// op's endTime; past portion is PAST_FRAC of the future portion. Once the user
// scrolls/drags we just use a symmetric (1-FUTURE_FRAC, FUTURE_FRAC) split.
const PAST_FRAC = 0.4;
const FUTURE_FRAC = 0.6;
const HEIGHT = 320;

function liqPriceUsd(raw) {
  if (!raw || raw === '0') return 0;
  try { return Number(BigInt(raw) / 10n ** 12n) / 1e6; } catch { return 0; }
}

function fmtMin(s) {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function fmtClock(ts) {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function CriminalChartSection({ address, grid, ethPrice = 0 }) {
  const { spans, heights, resize } = grid;
  const isFullAddr = /^0x[0-9a-fA-F]{40}$/.test(address || '');

  const [serverCandles, setServerCandles] = useState([]); // [{ts, open, high, low, close}] from /api/eth-candles
  const [companies, setCompanies]         = useState([]); // [{company, active, liqPrice, endTime}]
  const [tick, setTick]                 = useState(0);
  const [userSpan, setUserSpan]         = useState(null); // null = auto
  const [panSec, setPanSec]             = useState(0);    // offset added to "now" anchor
  const dragRef = useRef(null);
  const wrapRef = useRef(null);
  const svgRef  = useRef(null);
  const liveBufRef = useRef([]);  // [{ts, price}] — 1s-resolution samples from the ethPrice prop
  const [boxW,  setBoxW]                = useState(900);

  // 1s tick so countdown / "now" line move smoothly
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // measure container
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setBoxW(Math.max(300, Math.floor(e.contentRect.width)));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Candles from the server cache (lib/eth-candles.js). The bucket is picked
  // from the current chart span; the request re-fires when the bucket changes.
  // No local 1s buffer needed — the server cache already accumulates OHLC at
  // 1s feed resolution and exposes 2s/5s/15s/1m granularities.

  // active companies for the loaded wallet
  useEffect(() => {
    if (!isFullAddr) { setCompanies([]); return; }
    let live = true;
    const load = () => fetch(`/api/monitor?wallet=${address.toLowerCase()}`, { cache: 'no-cache' })
      .then(r => r.json())
      .then(d => { if (live && d && !d.error) setCompanies(d.companies || []); })
      .catch(() => {});
    load();
    const t = setInterval(load, 3_000);
    return () => { live = false; clearInterval(t); };
  }, [address, isFullAddr]);

  // Derived: parsed active ops with usd liq price
  const activeOps = useMemo(() => companies
    .filter(c => c.active && c.endTime > 0)
    .map(c => ({ ...c, liqUsd: liqPriceUsd(c.liqPrice), startTime: c.startTime ?? null })), [companies]);

  // Default window puts the furthest active endTime near the right edge:
  //   futureSec = max(endTime - now) + 10% buffer
  //   pastSec   = PAST_FRAC of futureSec
  // Once the user scrolls/drags we switch to a symmetric (PAST_FRAC, FUTURE_FRAC)
  // split of the chosen span.
  const now      = Math.floor(Date.now() / 1000);
  const maxEndIn = activeOps.length ? Math.max(...activeOps.map(o => Math.max(0, o.endTime - now))) : 0;
  const userOverride = userSpan != null || panSec !== 0;
  let xMin, xMax, span;
  if (userOverride) {
    span = userSpan ?? Math.min(SPAN_MAX, Math.max(SPAN_MIN, maxEndIn * 1.4 + 10 * 60));
    const anchor = now + panSec;
    xMin = anchor - span * PAST_FRAC;
    xMax = anchor + span * FUTURE_FRAC;
  } else {
    const futureSec = Math.max(maxEndIn * 1.1, 5 * 60);  // at least 5m future if no active ops
    const pastSec   = Math.max(futureSec * PAST_FRAC, 5 * 60);
    span = Math.min(SPAN_MAX, Math.max(SPAN_MIN, futureSec + pastSec));
    xMax = now + futureSec;
    xMin = xMax - span;
  }

  // Pick the server bucket size that matches the visible span.
  // Server provides 5s (last 30m), 15s (last 1h), 1m (last 2h).
  const bucketName = useMemo(() => {
    if (span <= 15 * 60) return '5s';   // ≤ 15m → 5s
    if (span <= 60 * 60) return '15s';  // ≤ 1h  → 15s
    return '1m';                        // > 1h  → 1m
  }, [span]);
  const bucketSec = { '5s': 5, '15s': 15, '1m': 60 }[bucketName];

  // Poll the candles endpoint for the chosen bucket. Cadence matches the
  // bucket size so we never refresh faster than candles are produced.
  useEffect(() => {
    let live = true;
    const interval = bucketSec * 1000;
    const load = () => fetch(`/api/eth-candles?bucket=${bucketName}`, { cache: 'no-cache' })
      .then(r => r.json())
      .then(d => { if (live && Array.isArray(d.candles)) setServerCandles(d.candles); })
      .catch(() => {});
    load();
    const t = setInterval(load, Math.min(5000, interval));
    return () => { live = false; clearInterval(t); };
  }, [bucketName, bucketSec]);

  // Visible candles. Server already trims to the bucket's maxAge; we further
  // clip to the chart window. tick is in the dep list so the last candle's
  // "in-progress" state visually advances each second between fetches.
  const candles = useMemo(() => {
    void tick;
    return serverCandles.filter(c => c.ts >= xMin - bucketSec && c.ts <= xMax);
  }, [serverCandles, xMin, xMax, bucketSec, tick]);

  // Y range — visible-min - $0.5 to visible-max + $0.5. Considers candle wicks
  // and the active ops' liq prices so all stay on-screen.
  const yMin = useMemo(() => {
    const arr = [...candles.map(c => c.low), ...activeOps.map(o => o.liqUsd)].filter(v => v > 0);
    if (!arr.length) return 0;
    return Math.min(...arr) - 0.5;
  }, [candles, activeOps]);
  const yMax = useMemo(() => {
    const arr = [...candles.map(c => c.high), ...activeOps.map(o => o.liqUsd)].filter(v => v > 0);
    if (!arr.length) return 1;
    return Math.max(...arr) + 0.5;
  }, [candles, activeOps]);

  // Layout
  const PAD = { l: 56, r: 12, t: 10, b: 22 };
  const w = boxW;
  const h = HEIGHT;
  const pw = Math.max(20, w - PAD.l - PAD.r);
  const ph = Math.max(20, h - PAD.t - PAD.b);
  const xScale = ts    => PAD.l + ((ts - xMin) / (xMax - xMin)) * pw;
  const yScale = price => PAD.t + (1 - (price - yMin) / (yMax - yMin || 1)) * ph;

  // Candle body width: bucketSec mapped to pixels, with some breathing room.
  const candleW = Math.max(2, (bucketSec / (xMax - xMin)) * pw * 0.7);

  // ── Interactions ────────────────────────────────────────────────────────
  // React's onWheel is registered as passive in newer versions, so
  // e.preventDefault() inside it is a no-op and the page keeps scrolling.
  // Attach via addEventListener with passive:false on the SVG element.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setUserSpan(prev => {
        const base = prev ?? span;
        return Math.min(SPAN_MAX, Math.max(SPAN_MIN, base * factor));
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [span]);
  function onPointerDown(e) {
    dragRef.current = { startX: e.clientX, startPan: panSec, spanAtStart: span, w };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const sec = -dx * (dragRef.current.spanAtStart / Math.max(1, dragRef.current.w - PAD.l - PAD.r));
    setPanSec(Math.round(dragRef.current.startPan + sec));
  }
  function onPointerUp(e) {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }
  function resetView() { setUserSpan(null); setPanSec(0); }

  // ── Render ──────────────────────────────────────────────────────────────
  const xNow = xScale(now);

  return (
    <section id="sec-watch" className="tm-grid-12">
      <GridCell id="watch-chart" span={spans['watch-chart']} height={heights['watch-chart']} onResize={(r) => resize('watch-chart', r)}>
        <Region
          title="criminal watch · live"
          sub={isFullAddr
            ? `${activeOps.length} active · span ${fmtMin(span)} · ${bucketName} candles${userSpan != null || panSec ? ' · custom' : ' · auto'}`
            : 'enter a 0x… address in the criminal rail to load'}
          actions={(userSpan != null || panSec !== 0) && (
            <button onClick={resetView} className="tm-hot" style={{ background: 'none', border: '1px solid var(--t-rule)', color: 'var(--t-fg-mut)', fontSize: 'var(--t-fs-xs)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>reset</button>
          )}
        >
          <div ref={wrapRef} style={{ width: '100%' }}>
            {!isFullAddr ? (
              <div className="dim" style={{ padding: 18 }}>no wallet selected</div>
            ) : (
              <svg
                ref={svgRef}
                width={w} height={h} viewBox={`0 0 ${w} ${h}`}
                style={{ display: 'block', cursor: dragRef.current ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {/* y grid + labels */}
                {[0, 0.25, 0.5, 0.75, 1].map(f => {
                  const y = PAD.t + f * ph;
                  const v = yMax - f * (yMax - yMin);
                  return (
                    <g key={f}>
                      <line x1={PAD.l} x2={w - PAD.r} y1={y} y2={y} stroke="var(--t-rule)" strokeDasharray="2 4" opacity="0.6" />
                      <text x={PAD.l - 6} y={y + 3} fill="var(--t-fg-soft)" fontSize="10" fontFamily="var(--t-font)" textAnchor="end">${v.toFixed(2)}</text>
                    </g>
                  );
                })}

                {/* x ticks */}
                {[0, 0.25, 0.5, 0.75, 1].map(f => {
                  const x = PAD.l + f * pw;
                  const ts = xMin + f * (xMax - xMin);
                  return (
                    <text key={f} x={x} y={h - 6} fill="var(--t-fg-soft)" fontSize="10" fontFamily="var(--t-font)" textAnchor="middle">{fmtClock(ts)}</text>
                  );
                })}

                {/* liq-price horizontals (red) */}
                {activeOps.filter(o => o.liqUsd >= yMin && o.liqUsd <= yMax).map((o, i) => (
                  <g key={`liq-${o.company}-${i}`}>
                    <line
                      x1={PAD.l} x2={w - PAD.r}
                      y1={yScale(o.liqUsd)} y2={yScale(o.liqUsd)}
                      stroke="var(--t-neg)" strokeWidth="1" strokeDasharray="4 3" opacity="0.85"
                    />
                    <text x={w - PAD.r - 4} y={yScale(o.liqUsd) - 3} fill="var(--t-neg)" fontSize="9" fontFamily="var(--t-font)" textAnchor="end">
                      liq ${o.liqUsd.toFixed(2)}
                    </text>
                  </g>
                ))}

                {/* start-time verticals (header colour, dotted) */}
                {activeOps.filter(o => o.startTime && o.startTime >= xMin && o.startTime <= xMax).map((o, i) => (
                  <g key={`start-${o.company}-${i}`}>
                    <line
                      x1={xScale(o.startTime)} x2={xScale(o.startTime)}
                      y1={PAD.t} y2={h - PAD.b}
                      stroke="var(--t-hdr)" strokeWidth="1" strokeDasharray="2 4" opacity="0.7"
                    />
                    <text x={xScale(o.startTime) + 3} y={h - PAD.b - 4} fill="var(--t-hdr)" fontSize="9" fontFamily="var(--t-font)">
                      {fmtMin(Math.max(0, now - o.startTime))}
                    </text>
                  </g>
                ))}

                {/* end-time verticals (green) */}
                {activeOps.filter(o => o.endTime >= xMin && o.endTime <= xMax).map((o, i) => (
                  <g key={`end-${o.company}-${i}`}>
                    <line
                      x1={xScale(o.endTime)} x2={xScale(o.endTime)}
                      y1={PAD.t} y2={h - PAD.b}
                      stroke="var(--t-pos)" strokeWidth="1" strokeDasharray="4 3" opacity="0.85"
                    />
                    <text x={xScale(o.endTime) + 3} y={PAD.t + 9} fill="var(--t-pos)" fontSize="9" fontFamily="var(--t-font)">
                      {fmtMin(Math.max(0, o.endTime - now))}
                    </text>
                  </g>
                ))}

                {/* now vertical */}
                {xNow >= PAD.l && xNow <= w - PAD.r && (
                  <line x1={xNow} x2={xNow} y1={PAD.t} y2={h - PAD.b} stroke="var(--t-hdr)" strokeWidth="1" opacity="0.6" />
                )}

                {/* candles */}
                {candles.map(c => {
                  const cx   = xScale(c.ts + bucketSec / 2);
                  const up   = c.close >= c.open;
                  const color = up ? 'var(--t-pos)' : 'var(--t-neg)';
                  const yHi  = yScale(c.high);
                  const yLo  = yScale(c.low);
                  const yO   = yScale(c.open);
                  const yC   = yScale(c.close);
                  const bodyTop    = Math.min(yO, yC);
                  const bodyHeight = Math.max(1, Math.abs(yC - yO));
                  return (
                    <g key={c.ts}>
                      <line x1={cx} x2={cx} y1={yHi} y2={yLo} stroke={color} strokeWidth="1" />
                      <rect x={cx - candleW / 2} y={bodyTop} width={candleW} height={bodyHeight} fill={color} opacity="0.85" />
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </Region>
      </GridCell>
    </section>
  );
}
