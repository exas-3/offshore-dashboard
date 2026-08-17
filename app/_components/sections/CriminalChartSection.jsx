'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Region, KVSep, GridCell, useLocations } from '../terminal.jsx';
import { fmtCountdownLocal } from '../trade-helpers.jsx';
import { useEthCandles } from '../hooks/use-eth-candles.js';
import { useEthHistory } from '../hooks/use-eth-history.js';
import { useChartViewport, useChartWheelZoom } from '../hooks/use-chart-viewport.js';
import { DEMO } from '../../../lib/demo-constants.js';

// Live SVG chart of ETH price with the selected wallet's active-op liq-price
// horizontal markers and op-end vertical markers. Visible only when a wallet
// is loaded into the criminal rail.
//
// Axes:  X = time (past → future, "now" centred-ish); Y = ETH price (auto-scaled)
// Wheel = zoom (5m ↔ 2h total span). Drag = pan in time.

// Viewport math (SPAN_MIN / SPAN_MAX / PAST_FRAC / FUTURE_FRAC) lives in
// hooks/use-chart-viewport.js. This file just composes hooks + SVG.
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
  return DEMO
    ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderCompaniesCard({ liveData, ethPrice, spans, heights, resize, locations, now }) {
  const allCompanies = liveData?.companies ?? [];
  // Render flag + city next to the company address (chip is decorative; the
  // company short address is still the unique identifier).
  const flagFor = (id) => {
    if (id == null) return null;
    const loc = locations?.get?.(Number(id));
    if (!loc) return null;
    const cityLabel = loc.city || loc.short_name || '';
    return (
      <span
        title={`${loc.city ?? ''}${loc.country ? `, ${loc.country}` : ''}`.trim() || loc.short_name}
        style={{ marginRight: 4, whiteSpace: 'nowrap' }}
      >
        <span style={{ marginRight: 3 }}>{loc.flag_emoji || ''}</span>
        <span className="dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{cityLabel}</span>
      </span>
    );
  };
  const chilling  = allCompanies.filter(c => !(c.active && c.endTime > 0));
  const liveEth   = ethPrice || liveData?.currentEthPrice || 0;
  // Sort active companies by buffer ascending (smallest = closest to
  // liquidation first). Missing liqPrice ('0' in demo reconstruction) or no
  // eth price → sink to bottom.
  const liqUsdOf = (c) => {
    if (!c.liqPrice) return 0;
    try { return Number(BigInt(c.liqPrice) / 10n ** 12n) / 1e6; } catch { return 0; }
  };
  const bufferOf = (c) => {
    const liq = liqUsdOf(c);
    if (!liveEth || liq <= 0) return Infinity;
    return liveEth - liq;
  };
  const liveOnes = allCompanies
    .filter(c => c.active && c.endTime > 0)
    .sort((a, b) => bufferOf(a) - bufferOf(b));

  const renderLive = (c) => {
    const liq = liqUsdOf(c);
    const buf = liveEth && liq > 0
      ? Math.round((liveEth - liq) * 100) / 100
      : null;
    return (
      <div key={c.company} className="tm-kv" style={{ marginBottom: 2 }}>
        <span className="k" style={{ fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs-xs)' }}>
          <span className="pos" style={{ marginRight: 4 }}>●</span>
          {flagFor(c.locationId)}
          {c.autoTradeEnabled && <span className="dim"> auto</span>}
        </span>
        <span className={`v ${buf == null ? '' : buf >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 'var(--t-fs-xs)' }}>
          {buf == null ? '—' : `${buf >= 0 ? '+' : ''}${buf.toFixed(2)}`}
          <span className="dim"> {fmtCountdownLocal(c.endTime, now)}</span>
        </span>
      </div>
    );
  };
  const renderChilling = (c) => {
    const nowS = now ?? Math.floor(Date.now() / 1000);
    const cdLeft = c.cooldownEnd && c.cooldownEnd > nowS ? c.cooldownEnd - nowS : 0;
    const note = cdLeft > 0 ? `cooldown ${fmtCountdownLocal(c.cooldownEnd, nowS)}` : 'idle';
    return (
      <div key={c.company} className="tm-kv" style={{ marginBottom: 2, opacity: 0.6 }}>
        <span className="k" style={{ fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs-xs)' }}>
          <span className="dim" style={{ marginRight: 4 }}>○</span>
          {flagFor(c.locationId)}
        </span>
        <span className="v dim" style={{ fontSize: 'var(--t-fs-xs)' }}>{note}</span>
      </div>
    );
  };

  return (
    <GridCell id="watch-companies" span={spans['watch-companies']} height={heights['watch-companies']} onResize={(r) => resize('watch-companies', r)}>
      <Region title="companies" sub={`${liveOnes.length} live · ${chilling.length} chilling`}>
        {liveOnes.length === 0 && chilling.length === 0 && (
          <div className="dim" style={{ fontSize: 'var(--t-fs-xs)', padding: '4px 0' }}>no companies</div>
        )}
        {liveOnes.length > 0 && (
          <>
            <div style={{ fontSize: 'var(--t-fs-xs)', color: 'var(--t-pos)', letterSpacing: '0.06em', margin: '2px 0' }}>live</div>
            {liveOnes.map(renderLive)}
          </>
        )}
        {chilling.length > 0 && (
          <>
            {liveOnes.length > 0 && <KVSep />}
            <div style={{ fontSize: 'var(--t-fs-xs)', color: 'var(--t-fg-soft)', letterSpacing: '0.06em', margin: '2px 0' }}>chilling</div>
            {chilling.map(renderChilling)}
          </>
        )}
      </Region>
    </GridCell>
  );
}

export function CriminalChartSection({ address, grid, ethPrice = 0, alarmOn = false, onAlarmToggle, liveData = null, now: nowProp = null }) {
  const { spans, heights, resize } = grid;
  const locations = useLocations();
  const isFullAddr = /^0x[0-9a-fA-F]{40}$/.test(address || '');

  const companies = liveData?.companies ?? [];
  const [tick, setTick] = useState(0);
  const wrapRef = useRef(null);
  const svgRef  = useRef(null);
  const [boxW,  setBoxW] = useState(900);

  // 1s tick so countdown / "now" line move smoothly.
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

  // Active ops with USD liq price + start time, derived from the parent's
  // single /api/monitor poll.
  const activeOps = useMemo(() => companies
    .filter(c => c.active && c.endTime > 0)
    .map(c => ({ ...c, liqUsd: liqPriceUsd(c.liqPrice), startTime: c.startTime ?? null })), [companies]);

  const now = nowProp ?? Math.floor(Date.now() / 1000);
  // Demo replays span multiple hours of DIRTY tape — allow a 6h window.
  const viewport = useChartViewport({ activeOps, now, spanMax: DEMO ? 6 * 3600 : undefined });
  const { span, xMin, xMax, panSec, userSpan, userOverride, setPanSec, dragRef, resetView } = viewport;
  useChartWheelZoom(wrapRef, viewport);

  const { candles, bucketName, bucketSec } = useEthCandles({ span, xMin, xMax, tick, enabled: !DEMO });
  // Demo: the exact historical RedStone oracle tape (60s, backfilled from
  // archive eth_calls) rendered as a line — same Y axis users expect live.
  const { points: ethPoints } = useEthHistory({ now, xMin, enabled: DEMO });
  const lastEth = ethPoints.length ? ethPoints[ethPoints.length - 1].price : null;

  // Y range — candle wicks / tape values plus the active ops' liq prices,
  // padded so everything stays on-screen.
  const yMin = useMemo(() => {
    const vals = DEMO ? ethPoints.map(p => p.price) : candles.map(c => c.low);
    const arr = [...vals, ...activeOps.map(o => o.liqUsd)].filter(v => v > 0);
    if (!arr.length) return 0;
    const lo = Math.min(...arr), hi = Math.max(...arr);
    return lo - Math.max(0.5, (hi - lo) * 0.1);
  }, [candles, activeOps, ethPoints]);
  const yMax = useMemo(() => {
    const vals = DEMO ? ethPoints.map(p => p.price) : candles.map(c => c.high);
    const arr = [...vals, ...activeOps.map(o => o.liqUsd)].filter(v => v > 0);
    if (!arr.length) return 1;
    const lo = Math.min(...arr), hi = Math.max(...arr);
    return hi + Math.max(0.5, (hi - lo) * 0.1);
  }, [candles, activeOps, ethPoints]);
  const fmtY = (v) => `$${v.toFixed(2)}`;

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
  // Wheel-to-zoom lives in useChartWheelZoom (attached above on wrapRef).
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

  // ── Render ──────────────────────────────────────────────────────────────
  const xNow = xScale(now);

  return (
    <section id="sec-watch" className="tm-grid-12">
      <GridCell id="watch-chart" span={spans['watch-chart']} height={heights['watch-chart']} onResize={(r) => resize('watch-chart', r)}>
        <Region
          title={DEMO ? 'criminal watch · replay' : 'criminal watch · live'}
          sub={isFullAddr
            ? `${activeOps.length} active · span ${fmtMin(span)} · ${DEMO ? '1m eth oracle tape' : `${bucketName} candles`}${userSpan != null || panSec ? ' · custom' : ' · auto'}`
            : 'enter a 0x… address in the criminal rail to load'}
          actions={(
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {(userSpan != null || panSec !== 0) && (
                <button onClick={resetView} className="tm-hot" style={{ background: 'none', border: '1px solid var(--t-rule)', color: 'var(--t-fg-mut)', fontSize: 'var(--t-fs-xs)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>reset</button>
              )}
              {onAlarmToggle && (
                <span
                  onClick={onAlarmToggle}
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 'var(--t-fs-xs)', userSelect: 'none',
                    color: alarmOn ? 'var(--t-warn)' : 'var(--t-fg-soft)' }}
                >
                  <span>⏰</span>
                  <span>{alarmOn ? 'alarm on' : 'alarm off'}</span>
                </span>
              )}
            </div>
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
                      <text x={PAD.l - 6} y={y + 3} fill="var(--t-fg-soft)" fontSize="10" fontFamily="var(--t-font)" textAnchor="end">{fmtY(v)}</text>
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

                {/* liq-price horizontals (red) — only when a real liq price
                    exists (demo reconstruction has none) */}
                {activeOps.filter(o => o.liqUsd > 0 && o.liqUsd >= yMin && o.liqUsd <= yMax).map((o, i) => (
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

                {/* start markers — small circle on each op's liq line at
                    the trade's start time, with the elapsed-since label.
                    Without a liq line (demo) the marker sits on the time axis. */}
                {activeOps
                  .filter(o => o.startTime && o.startTime >= xMin && o.startTime <= xMax
                            && (!(o.liqUsd > 0) || (o.liqUsd >= yMin && o.liqUsd <= yMax)))
                  .map((o, i) => {
                    const yMark = o.liqUsd > 0 ? yScale(o.liqUsd) : h - PAD.b - 6;
                    return (
                    <g key={`start-${o.company}-${i}`}>
                      <circle
                        cx={xScale(o.startTime)} cy={yMark}
                        r={3}
                        fill="var(--t-hdr)" stroke="var(--t-bg)" strokeWidth="1"
                        opacity="0.95"
                      />
                      <text x={xScale(o.startTime) + 6} y={yMark - 4}
                            fill="var(--t-hdr)" fontSize="9" fontFamily="var(--t-font)">
                        {fmtMin(Math.max(0, now - o.startTime))}
                      </text>
                    </g>
                    );
                  })}

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

                {/* current price horizontal + right-edge tag
                    (live: ETH oracle now · demo: oracle value at the virtual moment) */}
                {(() => {
                  const cur = DEMO ? lastEth : ethPrice;
                  if (!(cur > 0) || cur < yMin || cur > yMax) return null;
                  const yCur = yScale(cur);
                  const label = fmtY(cur);
                  const tagW = Math.max(48, label.length * 6 + 8);
                  return (
                    <g>
                      <line x1={PAD.l} x2={w - PAD.r} y1={yCur} y2={yCur} stroke="var(--t-hdr)" strokeWidth="1" opacity="0.9" />
                      <rect x={w - PAD.r - tagW} y={yCur - 8} width={tagW} height={14} fill="var(--t-hdr)" opacity="0.9" />
                      <text x={w - PAD.r - 4} y={yCur + 3} fill="var(--t-bg)" fontSize="10" fontFamily="var(--t-font)" textAnchor="end" fontWeight="500">{label}</text>
                    </g>
                  );
                })()}

                {/* demo: ETH oracle tape as line + area */}
                {DEMO && ethPoints.length > 1 && (() => {
                  const pts = ethPoints.map(p => [xScale(p.ts), yScale(p.price)]);
                  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
                  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h - PAD.b} L${pts[0][0].toFixed(1)},${h - PAD.b} Z`;
                  return (
                    <g>
                      <path d={area} fill="var(--t-fg)" opacity="0.07" />
                      <path d={line} fill="none" stroke="var(--t-fg)" strokeWidth="1.5" />
                      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.5" fill="var(--t-fg)" />
                    </g>
                  );
                })()}
                {DEMO && ethPoints.length <= 1 && (
                  <text x={PAD.l + pw / 2} y={PAD.t + ph / 2} fill="var(--t-fg-mut)" fontSize="10" fontFamily="var(--t-font)" textAnchor="middle">
                    eth oracle tape loading… (backfill may still be running for this range)
                  </text>
                )}

                {/* candles (live mode) */}
                {!DEMO && candles.map(c => {
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
            {isFullAddr && (() => {
              const d = new Date(now * 1000);
              const z = (n) => String(n).padStart(2, '0');
              const clock = DEMO
                ? `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())} UTC`
                : `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
              // Position the clock under the "now" vertical line. Clamp into
              // [PAD.l, w - PAD.r] so it stays on screen when the user has
              // panned away from now.
              const left = Math.max(PAD.l, Math.min(w - PAD.r, xNow));
              return (
                <div style={{ position: 'relative', height: 14, marginTop: 2, width: w }}>
                  <div style={{
                    position: 'absolute',
                    left,
                    transform: 'translateX(-50%)',
                    color: 'var(--t-hdr)',
                    fontFamily: 'var(--t-font)',
                    fontSize: 'var(--t-fs-xs)',
                  }}>{clock}</div>
                </div>
              );
            })()}
          </div>
        </Region>
      </GridCell>
      {renderCompaniesCard({ liveData, ethPrice, spans, heights, resize, locations, now })}
    </section>
  );
}
