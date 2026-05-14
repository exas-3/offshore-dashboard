// Chart + card primitives for Offshore dashboard.
// All theming via CSS vars on the .ofdash root: --bg, --surface, --border,
// --text, --muted, --accent-* etc. Components are theme-agnostic and just
// reach for vars.
//
// Exports (to window): Card, StatCard, HeroStat, BarChart, ComboBarLine,
//   LineArea, StackedBar, Heatmap, Treemap, Sparkline, ShareTable,
//   SectionHeading, Segmented, Tooltip, FormatNum

const { useState: useStateW, useMemo: useMemoW, useRef: useRefW, useEffect: useEffectW, useLayoutEffect: useLayoutEffectW } = React;

// ── Number formatting ───────────────────────────────────────────────────────
const FormatNum = {
  compact(n) {
    if (n == null) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 1 : 2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + 'k';
    return String(Math.round(n));
  },
  full(n) {
    if (n == null) return '—';
    return n.toLocaleString('en-US');
  },
  signed(n) {
    if (n == null) return '—';
    const s = n >= 0 ? '+' : '';
    return s + n.toLocaleString('en-US');
  },
};
window.FormatNum = FormatNum;

// ── Floating tooltip (positioned with portal-ish absolute on chart wrapper)
function useHoverPos() {
  const [pos, setPos] = useStateW(null); // {x, y, data}
  return [pos, setPos];
}

function Tooltip({ pos, children }) {
  if (!pos) return null;
  const { x, y } = pos;
  return (
    <div
      className="of-tt"
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  );
}
window.Tooltip = Tooltip;

// ── Card with optional colored top accent edge ─────────────────────────────
function Card({ accent, children, className = '', style, label, right, padding = true }) {
  return (
    <div
      className={`of-card ${className}`}
      data-accent={accent || undefined}
      style={style}
    >
      {accent ? <span className="of-card-edge" data-c={accent} /> : null}
      {label || right ? (
        <div className="of-card-head">
          {label ? <div className="of-card-label">{label}</div> : <span />}
          {right ? <div className="of-card-right">{right}</div> : null}
        </div>
      ) : null}
      <div className={padding ? 'of-card-body' : 'of-card-body of-card-body-nopad'}>{children}</div>
    </div>
  );
}
window.Card = Card;

function SectionHeading({ children, right }) {
  return (
    <div className="of-section-head">
      <h3>{children}</h3>
      {right ? <div>{right}</div> : null}
    </div>
  );
}
window.SectionHeading = SectionHeading;

// ── HeroStat — big number stat card with colored top edge ─────────────────
function HeroStat({ label, value, sub, accent }) {
  return (
    <Card accent={accent} label={label} className="of-hero">
      <div className="of-hero-value">{value}</div>
      {sub ? <div className="of-hero-sub">{sub}</div> : null}
    </Card>
  );
}
window.HeroStat = HeroStat;

// ── StatCard — smaller version used in indexed-stats grids ────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div className="of-statcard" data-accent={accent || undefined}>
      <div className="of-statcard-label">{label}</div>
      <div className="of-statcard-value" data-accent={accent || undefined}>{value}</div>
      {sub ? <div className="of-statcard-sub">{sub}</div> : null}
    </div>
  );
}
window.StatCard = StatCard;

// ── Segmented control (used for All / 7D / 30D / 1D, Daily / Hourly etc) ──
function Segmented({ value, options, onChange, size = 'sm' }) {
  return (
    <div className={`of-seg of-seg-${size}`}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        return (
          <button
            key={v}
            className={value === v ? 'is-on' : ''}
            onClick={() => onChange && onChange(v)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
window.Segmented = Segmented;

// ── Sparkline (inline, tiny) ───────────────────────────────────────────────
function Sparkline({ data, w = 96, h = 22, stroke = 'var(--accent-violet)', fill = 'none' }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} className="of-spark">
      <polyline points={pts.join(' ')} fill={fill} stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
window.Sparkline = Sparkline;

// ── BarChart — simple single-series bars ──────────────────────────────────
function BarChart({ data, color = 'violet', height = 260, valueFormat = FormatNum.compact, tooltipLabel = 'Value', yTicks = 4 }) {
  const [pos, setPos] = useHoverPos();
  const wrapRef = useRefW(null);
  const max = Math.max(...data.map((d) => d.v), 1);
  const ticks = useMemoW(() => {
    const step = niceStep(max / yTicks);
    const out = [];
    for (let v = 0; v <= max * 1.05; v += step) out.push(v);
    return out;
  }, [max, yTicks]);
  const topTick = ticks[ticks.length - 1];

  return (
    <div className="of-chart" style={{ height }} ref={wrapRef}>
      <div className="of-chart-yaxis">
        {[...ticks].reverse().map((t, i) => (
          <div key={i} className="of-chart-tick">
            <span>{valueFormat(t)}</span>
            <i className="of-chart-gridline" />
          </div>
        ))}
      </div>
      <div className="of-chart-plot of-bars">
        {data.map((d, i) => {
          const h = (d.v / topTick) * 100;
          return (
            <div
              key={i}
              className="of-bar-col"
              onMouseEnter={(e) => {
                const r = wrapRef.current.getBoundingClientRect();
                setPos({ x: e.clientX - r.left + 8, y: e.clientY - r.top - 8, data: d });
              }}
              onMouseMove={(e) => {
                const r = wrapRef.current.getBoundingClientRect();
                setPos({ x: e.clientX - r.left + 8, y: e.clientY - r.top - 8, data: d });
              }}
              onMouseLeave={() => setPos(null)}
            >
              <div className="of-bar-stack">
                <span className="of-bar" style={{ height: `${h}%`, background: `var(--accent-${color})` }} />
              </div>
              <div className="of-bar-x">{d.x ?? d.t}</div>
            </div>
          );
        })}
      </div>
      <Tooltip pos={pos}>
        {pos && (
          <>
            <div className="of-tt-row"><b>{tooltipLabel}</b><span>{valueFormat(pos.data.v)}</span></div>
            <div className="of-tt-foot">{pos.data.x ?? pos.data.t}</div>
          </>
        )}
      </Tooltip>
    </div>
  );
}
window.BarChart = BarChart;

// ── StackedBar — multi-series stacked ─────────────────────────────────────
function StackedBar({ data, series, height = 260, valueFormat = FormatNum.compact }) {
  const [pos, setPos] = useHoverPos();
  const wrapRef = useRefW(null);
  const totals = data.map((d) => series.reduce((s, k) => s + (d[k.key] || 0), 0));
  const max = Math.max(...totals, 1);
  const step = niceStep(max / 4);
  const ticks = [];
  for (let v = 0; v <= max * 1.05; v += step) ticks.push(v);
  const topTick = ticks[ticks.length - 1];

  return (
    <div className="of-chart" style={{ height }} ref={wrapRef}>
      <div className="of-chart-yaxis">
        {[...ticks].reverse().map((t, i) => (
          <div key={i} className="of-chart-tick">
            <span>{valueFormat(t)}</span>
            <i className="of-chart-gridline" />
          </div>
        ))}
      </div>
      <div className="of-chart-plot of-bars">
        {data.map((d, i) => {
          const total = totals[i];
          return (
            <div
              key={i}
              className="of-bar-col"
              onMouseEnter={(e) => {
                const r = wrapRef.current.getBoundingClientRect();
                setPos({ x: e.clientX - r.left + 8, y: e.clientY - r.top - 8, data: d, total });
              }}
              onMouseMove={(e) => {
                const r = wrapRef.current.getBoundingClientRect();
                setPos({ x: e.clientX - r.left + 8, y: e.clientY - r.top - 8, data: d, total });
              }}
              onMouseLeave={() => setPos(null)}
            >
              <div className="of-bar-stack">
                {series.map((s) => {
                  const h = ((d[s.key] || 0) / topTick) * 100;
                  if (!h) return null;
                  return <span key={s.key} className="of-bar" style={{ height: `${h}%`, background: `var(--accent-${s.color})` }} />;
                })}
              </div>
              <div className="of-bar-x">{d.x ?? d.t}</div>
            </div>
          );
        })}
      </div>
      <Tooltip pos={pos}>
        {pos && (
          <>
            {series.map((s) => (
              <div className="of-tt-row" key={s.key}>
                <span><i className="of-tt-dot" style={{ background: `var(--accent-${s.color})` }} />{s.label}</span>
                <span>{valueFormat(pos.data[s.key] || 0)}</span>
              </div>
            ))}
            <div className="of-tt-row of-tt-total"><b>Total</b><span>{valueFormat(pos.total)}</span></div>
            <div className="of-tt-foot">{pos.data.x ?? pos.data.t}</div>
          </>
        )}
      </Tooltip>
    </div>
  );
}
window.StackedBar = StackedBar;

// ── ComboBarLine — grouped bars + overlay line on right axis ─────────────
function ComboBarLine({ data, bars, line, height = 320, valueFormat = FormatNum.compact }) {
  const [pos, setPos] = useHoverPos();
  const wrapRef = useRefW(null);
  // Left axis max from bars
  const barMax = Math.max(...data.flatMap((d) => bars.map((b) => d[b.key] || 0)), 1);
  const barStep = niceStep(barMax / 4);
  const barTicks = [];
  for (let v = 0; v <= barMax * 1.05; v += barStep) barTicks.push(v);
  const barTop = barTicks[barTicks.length - 1];

  // Right axis: symmetric around 0 if line has negatives
  const lineVals = data.map((d) => d[line.key] || 0);
  const lineAbs = Math.max(...lineVals.map(Math.abs), 1);
  const lineStep = niceStep(lineAbs / 2);
  const lineTop = Math.ceil(lineAbs / lineStep) * lineStep;
  const lineTicks = [-lineTop, -lineTop / 2, 0, lineTop / 2, lineTop];

  // SVG path for line on plot, normalized 0..1 with 0 at center
  const linePoints = data.map((d, i) => {
    const x = (i + 0.5) / data.length;
    const y = 0.5 - (d[line.key] || 0) / (lineTop * 2);
    return [x, y];
  });

  return (
    <div className="of-chart of-chart-combo" style={{ height }} ref={wrapRef}>
      <div className="of-chart-yaxis">
        {[...barTicks].reverse().map((t, i) => (
          <div key={i} className="of-chart-tick">
            <span>{valueFormat(t)}</span>
            <i className="of-chart-gridline" />
          </div>
        ))}
      </div>
      <div className="of-chart-plot of-bars">
        {data.map((d, i) => (
          <div
            key={i}
            className="of-bar-col"
            onMouseEnter={(e) => {
              const r = wrapRef.current.getBoundingClientRect();
              setPos({ x: e.clientX - r.left + 8, y: e.clientY - r.top - 8, data: d });
            }}
            onMouseMove={(e) => {
              const r = wrapRef.current.getBoundingClientRect();
              setPos({ x: e.clientX - r.left + 8, y: e.clientY - r.top - 8, data: d });
            }}
            onMouseLeave={() => setPos(null)}
          >
            <div className="of-bar-stack of-bar-stack-group">
              {bars.map((b) => {
                const h = ((d[b.key] || 0) / barTop) * 100;
                return <span key={b.key} className="of-bar of-bar-grouped" style={{ height: `${h}%`, background: `var(--accent-${b.color})` }} />;
              })}
            </div>
            <div className="of-bar-x">{d.label ?? d.x}</div>
          </div>
        ))}
        {/* Line overlay */}
        <svg className="of-line-overlay" preserveAspectRatio="none" viewBox="0 0 1 1">
          <polyline
            points={linePoints.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke={`var(--accent-${line.color})`}
            strokeWidth="0.006"
            vectorEffect="non-scaling-stroke"
            style={{ strokeWidth: 1.5 }}
          />
        </svg>
      </div>
      <div className="of-chart-yaxis of-chart-yaxis-right">
        {[...lineTicks].reverse().map((t, i) => (
          <div key={i} className="of-chart-tick">
            <span>{valueFormat(t)}</span>
          </div>
        ))}
      </div>
      <Tooltip pos={pos}>
        {pos && (
          <>
            {bars.map((b) => (
              <div className="of-tt-row" key={b.key}>
                <span><i className="of-tt-dot" style={{ background: `var(--accent-${b.color})` }} />{b.label}</span>
                <span>{valueFormat(pos.data[b.key] || 0)}</span>
              </div>
            ))}
            <div className="of-tt-row">
              <span><i className="of-tt-dot" style={{ background: `var(--accent-${line.color})` }} />{line.label}</span>
              <span>{valueFormat(pos.data[line.key] || 0)}</span>
            </div>
            <div className="of-tt-foot">{pos.data.label || pos.data.x}</div>
          </>
        )}
      </Tooltip>
    </div>
  );
}
window.ComboBarLine = ComboBarLine;

// ── LineArea — smooth single-series line w/ filled area ──────────────────
function LineArea({ data, color = 'violet', height = 260, valueFormat = FormatNum.compact, tooltipLabel = 'Supply' }) {
  const [pos, setPos] = useHoverPos();
  const wrapRef = useRefW(null);
  const max = Math.max(...data.map((d) => d.v), 1);
  const min = Math.min(...data.map((d) => d.v), 0);
  const step = niceStep((max - min) / 4);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max * 1.02; v += step) ticks.push(v);
  if (ticks.length < 2) ticks.push(max);
  const topTick = ticks[ticks.length - 1];
  const botTick = ticks[0];
  const range = topTick - botTick || 1;

  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 1;
    const y = 1 - (d.v - botTick) / range;
    return [x, y];
  });
  // Cubic spline path
  const pathD = smoothPath(pts);
  const areaD = pathD + ` L 1,1 L 0,1 Z`;

  return (
    <div className="of-chart of-chart-line" style={{ height }} ref={wrapRef}>
      <div className="of-chart-yaxis">
        {[...ticks].reverse().map((t, i) => (
          <div key={i} className="of-chart-tick">
            <span>{valueFormat(t)}</span>
            <i className="of-chart-gridline of-chart-gridline-dashed" />
          </div>
        ))}
      </div>
      <div
        className="of-chart-plot of-line-plot"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const wr = wrapRef.current.getBoundingClientRect();
          const xFrac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          const idx = Math.round(xFrac * (data.length - 1));
          setPos({ x: e.clientX - wr.left + 8, y: e.clientY - wr.top - 8, data: data[idx], idx });
        }}
        onMouseLeave={() => setPos(null)}
      >
        <svg className="of-line-svg" preserveAspectRatio="none" viewBox="0 0 1 1">
          <path d={areaD} fill={`var(--accent-${color}-soft)`} opacity="0.5" />
          <path d={pathD} fill="none" stroke={`var(--accent-${color})`} strokeWidth="0.005" vectorEffect="non-scaling-stroke" style={{ strokeWidth: 2 }} />
          {pos && (
            <circle cx={pts[pos.idx][0]} cy={pts[pos.idx][1]} r="0.012" fill={`var(--accent-${color})`} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <div className="of-line-xaxis">
          {data.map((d, i) => i % Math.ceil(data.length / 9) === 0 || i === data.length - 1 ? (
            <span key={i} style={{ left: `${(i / (data.length - 1)) * 100}%` }}>{d.x ?? d.t}</span>
          ) : null)}
        </div>
      </div>
      <Tooltip pos={pos}>
        {pos && (
          <>
            <div className="of-tt-row"><b>{tooltipLabel}</b><span>{valueFormat(pos.data.v)}</span></div>
            <div className="of-tt-foot">{pos.data.x ?? pos.data.t}</div>
          </>
        )}
      </Tooltip>
    </div>
  );
}
window.LineArea = LineArea;

// ── Heatmap (24h × N days) ────────────────────────────────────────────────
function Heatmap({ grid, days, max, color = 'violet' }) {
  const m = max || Math.max(...grid.flat(), 1);
  return (
    <div className="of-heatmap">
      <div className="of-heatmap-rows">
        {grid.map((row, di) => (
          <div className="of-heatmap-row" key={di}>
            <div className="of-heatmap-rowlabel">{days[di]}</div>
            <div className="of-heatmap-cells">
              {row.map((v, hi) => {
                const a = Math.max(0.05, v / m);
                return (
                  <div
                    key={hi}
                    className="of-heatmap-cell"
                    style={{ background: `color-mix(in oklch, var(--accent-${color}) ${a * 100}%, transparent)` }}
                    title={`${days[di]} · ${String(hi).padStart(2, '0')}:00 · ${v} ops`}
                  />
                );
              })}
            </div>
          </div>
        ))}
        <div className="of-heatmap-row of-heatmap-axis">
          <div className="of-heatmap-rowlabel" />
          <div className="of-heatmap-cells">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="of-heatmap-haxis">{h % 4 === 0 ? `${String(h).padStart(2,'0')}` : ''}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
window.Heatmap = Heatmap;

// ── Treemap (simple slice-and-dice for share data) ───────────────────────
function Treemap({ items, height = 180 }) {
  // items: [{label, value, color}], we draw horizontal strips proportional to value
  const total = items.reduce((s, it) => s + it.value, 0) || 1;
  return (
    <div className="of-treemap" style={{ height }}>
      {items.map((it, i) => {
        const w = (it.value / total) * 100;
        return (
          <div
            key={i}
            className="of-treemap-tile"
            style={{ flex: `${w} 0 0`, background: `var(--accent-${it.color}-soft)`, borderColor: `var(--accent-${it.color})` }}
            title={`${it.label}: ${it.value}`}
          >
            <div className="of-treemap-label" style={{ color: `var(--accent-${it.color})` }}>{it.label}</div>
            <div className="of-treemap-value">{((it.value / total) * 100).toFixed(1)}%</div>
          </div>
        );
      })}
    </div>
  );
}
window.Treemap = Treemap;

// ── ShareTable — small table with type/ops/dirty/share columns ───────────
function ShareTable({ headers, rows }) {
  return (
    <table className="of-table of-share-table">
      <thead>
        <tr>{headers.map((h, i) => <th key={i} style={{ textAlign: h.align || 'left' }}>{h.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>
              <span className="of-share-dot" style={{ background: `var(--accent-${r.color})` }} />
              <span>{r.type}</span>
            </td>
            <td style={{ textAlign: 'right' }}>{r.count != null ? r.count : r.ops}</td>
            <td style={{ textAlign: 'right' }} className={`of-share-num of-share-num-${r.color}`}>{r.dirty}</td>
            <td style={{ textAlign: 'right' }} className="of-share-pct">{r.share == null ? '—' : r.share.toFixed(1) + '%'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
window.ShareTable = ShareTable;

// ── Grouped bars for compact dual (earned vs spent) per-day ──────────────
function GroupedBars({ data, series, height = 240, valueFormat = FormatNum.compact }) {
  const [pos, setPos] = useHoverPos();
  const wrapRef = useRefW(null);
  const max = Math.max(...data.flatMap((d) => series.map((s) => d[s.key] || 0)), 1);
  const step = niceStep(max / 4);
  const ticks = [];
  for (let v = 0; v <= max * 1.05; v += step) ticks.push(v);
  const top = ticks[ticks.length - 1];
  return (
    <div className="of-chart" style={{ height }} ref={wrapRef}>
      <div className="of-chart-yaxis">
        {[...ticks].reverse().map((t, i) => (
          <div key={i} className="of-chart-tick">
            <span>{valueFormat(t)}</span>
            <i className="of-chart-gridline of-chart-gridline-dashed" />
          </div>
        ))}
      </div>
      <div className="of-chart-plot of-bars">
        {data.map((d, i) => (
          <div
            key={i}
            className="of-bar-col"
            onMouseEnter={(e) => {
              const r = wrapRef.current.getBoundingClientRect();
              setPos({ x: e.clientX - r.left + 8, y: e.clientY - r.top - 8, data: d });
            }}
            onMouseMove={(e) => {
              const r = wrapRef.current.getBoundingClientRect();
              setPos({ x: e.clientX - r.left + 8, y: e.clientY - r.top - 8, data: d });
            }}
            onMouseLeave={() => setPos(null)}
          >
            <div className="of-bar-stack of-bar-stack-group">
              {series.map((s) => {
                const h = ((d[s.key] || 0) / top) * 100;
                return <span key={s.key} className="of-bar of-bar-grouped" style={{ height: `${h}%`, background: `var(--accent-${s.color})` }} />;
              })}
            </div>
            <div className="of-bar-x">{d.x ?? d.t}</div>
          </div>
        ))}
      </div>
      <Tooltip pos={pos}>
        {pos && (
          <>
            {series.map((s) => (
              <div className="of-tt-row" key={s.key}>
                <span><i className="of-tt-dot" style={{ background: `var(--accent-${s.color})` }} />{s.label}</span>
                <span>{valueFormat(pos.data[s.key] || 0)}</span>
              </div>
            ))}
            <div className="of-tt-foot">{pos.data.x ?? pos.data.t}</div>
          </>
        )}
      </Tooltip>
    </div>
  );
}
window.GroupedBars = GroupedBars;

// ── Legend ────────────────────────────────────────────────────────────────
function Legend({ items }) {
  return (
    <div className="of-legend">
      {items.map((i) => (
        <span key={i.label} className="of-legend-item">
          <i className={`of-legend-swatch ${i.shape === 'line' ? 'of-legend-swatch-line' : ''}`} style={{ background: `var(--accent-${i.color})` }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
window.Legend = Legend;

// ── Helpers ───────────────────────────────────────────────────────────────
function niceStep(raw) {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  let nice;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  return nice * pow;
}

function smoothPath(pts) {
  if (!pts.length) return '';
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    const cx1 = x1 + (x2 - x1) / 2;
    const cx2 = x1 + (x2 - x1) / 2;
    d += ` C ${cx1},${y1} ${cx2},${y2} ${x2},${y2}`;
  }
  return d;
}
