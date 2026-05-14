// MEGADASH terminal system — shell + reusable widget primitives.
// Each future app dashboard wraps its content in <TerminalShell>.
//
// Exports: TerminalShell, Region, Stats, KV, BarRow, BarRow2, BlockRow,
//   ShareTable, Sortable, Spark, Heatmap, ComboChart, LineChart,
//   Toasts, Seg, blockBar, fmt

const { useState: useStateT, useRef: useRefT, useEffect: useEffectT, useMemo: useMemoT } = React;

// ── Number formatting ─────────────────────────────────────────────────────
const fmt = {
  k(n) {
    if (n == null) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
    return String(Math.round(n));
  },
  n(n) { return n == null ? '—' : n.toLocaleString('en-US'); },
  pct(n, digits = 1) { return n == null ? '—' : n.toFixed(digits) + '%'; },
  signed(n) { if (n == null) return '—'; return (n >= 0 ? '+' : '') + n.toLocaleString('en-US'); },
};
window.fmt = fmt;

// ── Block-char bar ────────────────────────────────────────────────────────
function blockBar(v, max, width = 28) {
  const filled = Math.max(0, Math.min(1, v / max)) * width;
  const whole = Math.floor(filled);
  const frac = filled - whole;
  const partials = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const pIdx = Math.min(7, Math.round(frac * 8));
  return '█'.repeat(whole) + partials[pIdx] + ' '.repeat(Math.max(0, width - whole - (pIdx ? 1 : 0)));
}
window.blockBar = blockBar;

// ── Shell ─────────────────────────────────────────────────────────────────
function TerminalShell({ apps, activeAppId, onAppChange, ticker, tabs, activeTab, onTabChange, search, onSearch, fkeys, sideFooter, children, rail, clock, theme = 'amber', density = 'regular', mode = 'standalone', nav, brand, sideContent, railLabel = 'wallet', onThemeChange }) {
  const [now, setNow] = useStateT(clock || nowUTC());
  const [activeSection, setActiveSection] = useStateT(nav && nav[0] ? nav[0].id : null);
  const [railOpen, setRailOpen] = useStateT(false);
  useEffectT(() => {
    if (clock) return;
    const t = setInterval(() => setNow(nowUTC()), 1000);
    return () => clearInterval(t);
  }, [clock]);

  // Scroll-spy for the section nav in standalone mode.
  useEffectT(() => {
    if (mode !== 'standalone' || !nav) return;
    const root = document.querySelector('.tm-main-scroll');
    if (!root) return;
    const targets = nav.map((n) => document.getElementById(`sec-${n.id}`)).filter(Boolean);
    if (!targets.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        // Pick the topmost intersecting target
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id.replace('sec-', ''));
      },
      { root, rootMargin: '-60px 0px -60% 0px', threshold: 0 }
    );
    targets.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [mode, nav]);

  function jumpTo(id) {
    setActiveSection(id);
    const el = document.getElementById(`sec-${id}`);
    const root = document.querySelector('.tm-main-scroll');
    if (el && root) root.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
  }

  return (
    <div className="tm" data-theme={theme} data-density={density} data-mode={mode}>
      <div className="tm-ticker">
        {(ticker || []).map((c, i) => (
          <span className="tm-ticker-cell" key={i}>
            <span className="tm-ticker-k">{c.k}</span>
            <span className={`tm-ticker-v ${c.cls || ''}`}>{c.v}</span>
            {c.trend != null && (
              <span className={c.trend >= 0 ? 'pos' : 'neg'}>
                {c.trend >= 0 ? '▲' : '▼'}{Math.abs(c.trend).toFixed(2)}{c.trendUnit || '%'}
              </span>
            )}
          </span>
        ))}
        <span className="tm-ticker-clock">{now}</span>
        {onThemeChange ? (
          <span className="tm-themepicker" title="theme">
            {[
              { id: 'amber',  dot: '#ffb000' },
              { id: 'green',  dot: '#4ade80' },
              { id: 'purple', dot: '#a674ff' },
              { id: 'paper',  dot: '#1a1408', bg: '#f7f3e8' },
            ].map((th) => (
              <button
                key={th.id}
                className={`tm-themedot ${theme === th.id ? 'on' : ''}`}
                onClick={() => onThemeChange(th.id)}
                title={th.id}
                style={{ background: th.dot, boxShadow: th.bg ? `inset 0 0 0 1px ${th.bg}` : undefined }}
              />
            ))}
          </span>
        ) : null}
      </div>

      <aside className="tm-side">
        <div className="tm-side-h">
          <div className="tm-side-mark">{brand?.name || 'OFFSHORE'}<em>·</em></div>
          <div className="tm-side-sub">{brand?.sub || 'dashboard · v0.3'}</div>
        </div>

        {sideContent ? (
          sideContent
        ) : mode === 'standalone' ? (
          <>
            <div className="tm-side-lbl">Sections</div>
            <nav className="tm-side-nav">
              {(nav || []).map((n) => (
                <button
                  key={n.id}
                  className={`tm-side-item ${n.id === activeSection ? 'is-active' : ''}`}
                  onClick={() => jumpTo(n.id)}
                >
                  <span className="tm-side-glyph">{n.fkey || ''}</span>
                  <span className="tm-side-name">{n.label}</span>
                </button>
              ))}
            </nav>
          </>
        ) : (
          <>
            <div className="tm-side-lbl">Apps</div>
            <nav className="tm-side-nav">
              {(apps || []).filter((a) => !a.isMeta).map((a) => (
                <button
                  key={a.id}
                  className={`tm-side-item ${a.id === activeAppId ? 'is-active' : ''} ${a.active ? '' : 'is-stub'}`}
                  onClick={() => a.active && onAppChange && onAppChange(a.id)}
                  title={a.active ? a.name : `${a.name} — coming soon`}
                >
                  <span className="tm-side-glyph">{String(((apps || []).filter((x) => !x.isMeta).indexOf(a) + 1)).padStart(2, '0')}</span>
                  <span className="tm-side-name">{a.name.toLowerCase()}</span>
                  {a.active ? <span className="tm-side-tag">{a.tag}</span> : <span className="tm-side-soon">SOON</span>}
                </button>
              ))}
            </nav>

            <div className="tm-side-lbl">Index</div>
            <nav className="tm-side-nav">
              {(apps || []).filter((a) => a.isMeta).map((a) => (
                <button key={a.id} className="tm-side-item is-stub" title={`${a.name} — coming soon`}>
                  <span className="tm-side-glyph">M*</span>
                  <span className="tm-side-name">{a.name.toLowerCase()}</span>
                  <span className="tm-side-soon">SOON</span>
                </button>
              ))}
            </nav>
          </>
        )}

        <div className="tm-side-foot">
          {(sideFooter || []).map((row, i) => (
            <div key={i} className="row"><span>{row.k}</span><b className={row.cls || ''}>{row.v}</b></div>
          ))}
        </div>
      </aside>

      <main className="tm-main">
        <div className="tm-cmd">
          <span className="prompt">&gt;</span>
          {(tabs || []).map((t) => (
            <span
              key={t}
              className={`tag ${t === activeTab ? 'on' : ''}`}
              onClick={() => onTabChange && onTabChange(t)}
            >{t}</span>
          ))}
          <input
            value={search || ''}
            onChange={(e) => onSearch && onSearch(e.target.value)}
            placeholder="search address · 0x… · / to focus"
          />
          <span className="ctx">megaeth-mainnet · 12s</span>
        </div>
        <div className="tm-main-row">
          <div className="tm-main-scroll">
            {children}
          </div>
          {rail ? (
            <div className={`tm-rail ${railOpen ? 'is-open' : 'is-closed'}`}>
              <button
                className="tm-rail-toggle"
                onClick={() => setRailOpen((o) => !o)}
                title={railOpen ? 'collapse' : 'expand'}
              >
                <span className="caret">{railOpen ? '›' : '‹'}</span>
                {!railOpen ? <span className="vlabel">{railLabel}</span> : null}
              </button>
              {railOpen ? <div className="tm-rail-body">{rail}</div> : null}
            </div>
          ) : null}
        </div>
      </main>

      <div className="tm-fkeys">
        {(fkeys || []).map((f, i) => (
          <span key={i}><b>{f.k}</b> {f.label}</span>
        ))}
        <span className="right">offshore protocol · block 4,128,907 · gas 0.001 gwei</span>
      </div>
    </div>
  );
}

function nowUTC() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getUTCHours())}:${z(d.getUTCMinutes())}:${z(d.getUTCSeconds())} UTC`;
}

window.TerminalShell = TerminalShell;

// ── Region ────────────────────────────────────────────────────────────────
function Region({ title, sub, fkey, actions, focus, children, headRight, endControls, height }) {
  const style = height ? { height: typeof height === 'number' ? `${height}px` : height } : undefined;
  return (
    <div className="tm-region" data-focus={focus ? 'true' : undefined} style={style}>
      <div className="tm-region-head">
        <span className="ttl">{title}{sub ? <> <b>· {sub}</b></> : null}</span>
        <span className="leader" />
        {actions ? <span className="actions">{actions}</span> : null}
        {headRight ? <span className="actions">{headRight}</span> : null}
        {fkey ? <span className="fkey">{fkey}</span> : null}
        {endControls ? <span className="tm-region-end">{endControls}</span> : null}
      </div>
      <div className="tm-region-body">{children}</div>
    </div>
  );
}
window.Region = Region;

// ── Stats grid ────────────────────────────────────────────────────────────
function Stats({ items, cols }) {
  const c = cols || items.length;
  return (
    <div className="tm-stats" style={{ '--cols': c }}>
      {items.map((s, i) => (
        <div className="tm-stat" key={i}>
          <div className="tm-stat-k">{s.k}</div>
          <div className={`tm-stat-v ${s.cls || ''}`}>{s.v}</div>
          {s.sub != null ? <div className="tm-stat-sub">{s.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}
window.Stats = Stats;

// ── KV row ────────────────────────────────────────────────────────────────
function KV({ k, v, cls, sub }) {
  return (
    <>
      <div className="tm-kv">
        <span className="tm-kv-k">{k}</span>
        <span className={`tm-kv-v ${cls || ''}`}>{v}</span>
      </div>
      {sub ? <div className="tm-kv-sub">{sub}</div> : null}
    </>
  );
}
window.KV = KV;
function KVSep() { return <div className="tm-kv-sep" />; }
window.KVSep = KVSep;

// ── Single-series bar row ─────────────────────────────────────────────────
function BarRow({ data, max, color = 'fg', valueFmt = fmt.k }) {
  const m = max || Math.max(...data.map((d) => d.v), 1);
  return (
    <>
      {data.map((d) => (
        <div className="tm-barrow" key={d.x}>
          <span className="lbl">{d.x}</span>
          <span className="tm-track">
            <i className={color === 'fg' ? '' : color} style={{ width: `${(d.v / m) * 100}%` }} />
          </span>
          <span className="num">{valueFmt(d.v)}</span>
        </div>
      ))}
    </>
  );
}
window.BarRow = BarRow;

// ── Two-series bar row (e.g. earned vs spent) ─────────────────────────────
function BarRow2({ data, series, max, valueFmt = fmt.k }) {
  const m = max || Math.max(...data.flatMap((d) => series.map((s) => d[s.key] || 0)), 1);
  return (
    <>
      {data.map((d, i) => (
        <div className="tm-barrow-2" key={d.x ?? i}>
          <span className="lbl" style={{ color: 'var(--t-fg-soft)' }}>{d.x ?? d.t}</span>
          <span className="tm-track" title={series[0].label}>
            <i className={series[0].color} style={{ width: `${((d[series[0].key] || 0) / m) * 100}%` }} />
          </span>
          <span className="tm-track" title={series[1].label}>
            <i className={series[1].color} style={{ width: `${((d[series[1].key] || 0) / m) * 100}%` }} />
          </span>
          <span className="lbl" style={{ textAlign: 'right', color: 'var(--t-num)', fontWeight: 500 }}>
            <span className={series[0].color}>{valueFmt(d[series[0].key] || 0)}</span> · <span className={series[1].color}>{valueFmt(d[series[1].key] || 0)}</span>
          </span>
        </div>
      ))}
    </>
  );
}
window.BarRow2 = BarRow2;

// ── Stacked bar row (multi-series) ────────────────────────────────────────
function StackedBarRow({ data, series, max, valueFmt = fmt.k }) {
  const totals = data.map((d) => series.reduce((s, k) => s + (d[k.key] || 0), 0));
  const m = max || Math.max(...totals, 1);
  return (
    <>
      {data.map((d, i) => (
        <div className="tm-barrow" key={d.x ?? i}>
          <span className="lbl">{d.x ?? d.t}</span>
          <span className="tm-track">
            <span className="tm-track-stack">
              {series.map((s) => {
                const w = ((d[s.key] || 0) / m) * 100;
                return <span key={s.key} className={s.color} style={{ width: `${w}%`, background: `var(--t-${s.colorVar || (s.color === 'pos' ? 'pos' : s.color === 'neg' ? 'neg' : s.color === 'hdr' ? 'hdr' : 'fg')})` }} />;
              })}
            </span>
          </span>
          <span className="num">{valueFmt(totals[i])}</span>
        </div>
      ))}
    </>
  );
}
window.StackedBarRow = StackedBarRow;

// ── Block-char (TUI) bar row ──────────────────────────────────────────────
function BlockRow({ data, max, color = '', valueFmt = fmt.k, width = 28 }) {
  const m = max || Math.max(...data.map((d) => d.v), 1);
  return (
    <>
      {data.map((d) => (
        <div className="tm-blockrow" key={d.x}>
          <span className="lbl">{d.x}</span>
          <span className={`glyphs ${color}`}>{blockBar(d.v, m, width)}</span>
          <span className="num">{valueFmt(d.v)}</span>
        </div>
      ))}
    </>
  );
}
window.BlockRow = BlockRow;

// ── Sparkline (SVG, inline) ───────────────────────────────────────────────
function Spark({ data, w = 80, h = 20, color = 'var(--t-fg)' }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 1 - ((v - min) / range) * (h - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="tm-spark" width={w} height={h} aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.25" />
    </svg>
  );
}
window.Spark = Spark;

// ── Heatmap (24h × N days) ────────────────────────────────────────────────
function Heatmap({ grid, days, max }) {
  const m = max || Math.max(...grid.flat(), 1);
  return (
    <div className="tm-heat">
      {grid.map((row, di) => (
        <div className="tm-heat-row" key={di}>
          <span className="lbl">{days[di]}</span>
          <div className="tm-heat-cells">
            {row.map((v, hi) => {
              const a = Math.max(0.05, v / m);
              return <div key={hi} className="tm-heat-cell" style={{ background: 'var(--t-fg)', opacity: a.toFixed(2) }} title={`${days[di]} · ${String(hi).padStart(2, '0')}:00 · ${v}`} />;
            })}
          </div>
        </div>
      ))}
      <div className="tm-heat-axis">
        <span className="lbl" />
        <div className="hours">{Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 4 === 0 ? String(h).padStart(2, '0') : ''}</span>)}</div>
      </div>
    </div>
  );
}
window.Heatmap = Heatmap;

// ── Segmented control ────────────────────────────────────────────────────
function Seg({ value, options, onChange }) {
  return (
    <span className="tm-seg">
      {options.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return (
          <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange && onChange(v)}>{l}</button>
        );
      })}
    </span>
  );
}
window.Seg = Seg;

// ── Sortable header cell ──────────────────────────────────────────────────
function Sortable({ label, k, sortKey, sortDir, on }) {
  return (
    <button className={`tm-sort ${sortKey === k ? 'on' : ''}`} onClick={() => on(k)}>
      {label}
      <span className="tm-sort-caret">{sortKey === k ? (sortDir === 'asc' ? '▴' : '▾') : '↕'}</span>
    </button>
  );
}
window.Sortable = Sortable;

// ── ComboChart (SVG bars + line, used for emissions vs burn) ─────────────
function ComboChart({ data, bars, line, height = 220 }) {
  const wrapRef = useRefT(null);
  const [hover, setHover] = useStateT(null);

  const barMax = Math.max(...data.flatMap((d) => bars.map((b) => d[b.key] || 0)), 1);
  const barStep = niceStep(barMax / 4);
  const barTicks = [];
  for (let v = 0; v <= barMax * 1.05; v += barStep) barTicks.push(v);
  const barTop = barTicks[barTicks.length - 1];

  const lineVals = data.map((d) => d[line.key] || 0);
  const lineAbs = Math.max(...lineVals.map(Math.abs), 1);
  const lineStep = niceStep(lineAbs / 2);
  const lineTop = Math.ceil(lineAbs / lineStep) * lineStep;
  const lineTicks = [-lineTop, -lineTop / 2, 0, lineTop / 2, lineTop];

  const W = 1000, H = height;
  const PAD_L = 38, PAD_R = 36, PAD_T = 8, PAD_B = 22;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const groupW = plotW / data.length;
  const barInnerW = groupW * 0.7;
  const barW = barInnerW / bars.length;

  // Line points
  const linePts = data.map((d, i) => {
    const x = PAD_L + groupW * (i + 0.5);
    const y = PAD_T + plotH / 2 - ((d[line.key] || 0) / lineTop) * (plotH / 2);
    return [x, y];
  });

  return (
    <div className="tm-svg-wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`}>
        {/* grid */}
        {barTicks.map((t, i) => {
          const y = PAD_T + plotH - (t / barTop) * plotH;
          return (
            <g key={i}>
              <line className="tm-svg-grid" x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} />
              <text className="tm-svg-axis" x={PAD_L - 4} y={y + 3} textAnchor="end">{fmt.k(t)}</text>
            </g>
          );
        })}
        {/* right axis (line) */}
        {lineTicks.map((t, i) => {
          const y = PAD_T + plotH / 2 - (t / lineTop) * (plotH / 2);
          return <text key={i} className="tm-svg-axis" x={W - PAD_R + 4} y={y + 3} textAnchor="start">{fmt.k(t)}</text>;
        })}
        {/* bars */}
        {data.map((d, i) => (
          <g key={i}>
            {bars.map((b, bi) => {
              const h = ((d[b.key] || 0) / barTop) * plotH;
              const x = PAD_L + groupW * i + groupW * 0.15 + bi * barW;
              const y = PAD_T + plotH - h;
              return <rect key={b.key} x={x} y={y} width={barW - 1} height={h} fill={`var(--t-${b.color})`} />;
            })}
          </g>
        ))}
        {/* line */}
        <polyline
          points={linePts.map((p) => p.join(',')).join(' ')}
          fill="none"
          stroke={`var(--t-${line.color})`}
          strokeWidth="1.5"
        />
        {linePts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={2.2} fill={`var(--t-${line.color})`} />)}
        {/* x axis */}
        {data.map((d, i) => i % Math.ceil(data.length / 9) === 0 ? (
          <text key={i} className="tm-svg-axis" x={PAD_L + groupW * (i + 0.5)} y={H - 6} textAnchor="middle">{d.label || d.x}</text>
        ) : null)}
        {/* hover overlay */}
        {data.map((d, i) => {
          const x = PAD_L + groupW * i;
          return (
            <rect
              key={`h-${i}`}
              x={x} y={PAD_T} width={groupW} height={plotH}
              fill="transparent"
              onMouseEnter={(e) => {
                const r = wrapRef.current.getBoundingClientRect();
                setHover({ x: e.clientX - r.left, y: e.clientY - r.top, d, i });
              }}
              onMouseMove={(e) => {
                const r = wrapRef.current.getBoundingClientRect();
                setHover({ x: e.clientX - r.left, y: e.clientY - r.top, d, i });
              }}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>
      {hover && (
        <div className="tm-tt" style={{ left: hover.x + 8, top: hover.y - 8 }}>
          {bars.map((b) => (
            <div className="tm-tt-row" key={b.key}>
              <span className="k">{b.label}</span>
              <span className={`v tm-${b.color}`}>{fmt.k(hover.d[b.key] || 0)}</span>
            </div>
          ))}
          <div className="tm-tt-row">
            <span className="k">{line.label}</span>
            <span className={`v tm-${line.color}`}>{fmt.signed(hover.d[line.key] || 0)}</span>
          </div>
          <div className="tm-tt-row" style={{ marginTop: 4, borderTop: '1px dotted var(--t-rule)', paddingTop: 4 }}>
            <span className="k">{hover.d.label || hover.d.x}</span>
          </div>
        </div>
      )}
    </div>
  );
}
window.ComboChart = ComboChart;

// ── LineChart (simple smooth line) ────────────────────────────────────────
function LineChart({ data, height = 160, color = 'fg', valueFmt = fmt.k }) {
  const max = Math.max(...data.map((d) => d.v), 1);
  const min = Math.min(...data.map((d) => d.v), 0);
  const step = niceStep((max - min) / 4);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max * 1.02; v += step) ticks.push(v);
  if (ticks.length < 2) ticks.push(max);
  const top = ticks[ticks.length - 1];
  const bot = ticks[0];
  const range = top - bot || 1;

  const W = 1000, H = height;
  const PAD_L = 56, PAD_R = 8, PAD_T = 6, PAD_B = 22;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const pts = data.map((d, i) => {
    const x = PAD_L + (i / (data.length - 1)) * plotW;
    const y = PAD_T + plotH - ((d.v - bot) / range) * plotH;
    return [x, y];
  });

  // Smooth path
  let path = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    const cx = (x1 + x2) / 2;
    path += ` C ${cx},${y1} ${cx},${y2} ${x2},${y2}`;
  }
  const areaPath = path + ` L ${pts[pts.length-1][0]},${PAD_T + plotH} L ${pts[0][0]},${PAD_T + plotH} Z`;

  return (
    <div className="tm-svg-wrap">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {ticks.map((t, i) => {
          const y = PAD_T + plotH - ((t - bot) / range) * plotH;
          return (
            <g key={i}>
              <line className="tm-svg-grid" x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} />
              <text className="tm-svg-axis" x={PAD_L - 4} y={y + 3} textAnchor="end">{valueFmt(t)}</text>
            </g>
          );
        })}
        <path d={areaPath} fill={`var(--t-${color})`} opacity="0.08" />
        <path d={path} fill="none" stroke={`var(--t-${color})`} strokeWidth="1.5" />
        {data.map((d, i) => i % Math.ceil(data.length / 9) === 0 ? (
          <text key={i} className="tm-svg-axis" x={PAD_L + (i / (data.length - 1)) * plotW} y={H - 6} textAnchor="middle">{d.x ?? d.t}</text>
        ) : null)}
      </svg>
    </div>
  );
}
window.LineChart = LineChart;

// ── Live toasts (positioned fixed to viewport corner) ────────────────────
function Toasts({ items, interval = 2400, max = 3 }) {
  const [stack, setStack] = useStateT([]);
  const [tick, setTick] = useStateT(0);
  useEffectT(() => { const t = setInterval(() => setTick((x) => x + 1), interval); return () => clearInterval(t); }, [interval]);
  useEffectT(() => {
    if (!items || !items.length) return;
    const next = items[tick % items.length];
    const id = `${tick}-${Math.random().toString(36).slice(2, 6)}`;
    setStack((s) => [{ ...next, id }, ...s].slice(0, max));
    const drop = setTimeout(() => setStack((s) => s.filter((x) => x.id !== id)), interval * (max + 0.5));
    return () => clearTimeout(drop);
  }, [tick, items, interval, max]);
  return (
    <div className="tm-toasts">
      {stack.map((t) => (
        <div key={t.id} className={`tm-toast ${t.kind.toLowerCase()}`}>
          <span className="kind">{t.label || t.kind}</span>
          <span className="amt">{t.amount} <em>{t.token}</em></span>
          <span className="addr">{t.addr}</span>
        </div>
      ))}
    </div>
  );
}
window.Toasts = Toasts;

// ── GridCell ──────────────────────────────────────────────────────────────
// Wraps a Region in a grid cell. The grip at bottom-right resizes BOTH:
//   • width   — adjusts this cell's column span (3..12); the paired sibling
//                in the same row gets 12 - newSpan, so neighbours stay flush.
//   • height  — pixel-precise; passed through to the Region as inline height.
// onResize({ span, height }) is called as the user drags.
function GridCell({ id, span = 6, height, onResize, pair, children }) {
  const cellRef = useRefT(null);
  const [drag, setDrag] = useStateT(null); // { startX, startY, startSpan, startHeight, parentWidth }

  function onGripDown(e) {
    e.preventDefault();
    const parent = cellRef.current && cellRef.current.parentElement;
    const cell   = cellRef.current;
    if (!parent || !cell) return;
    const parentRect = parent.getBoundingClientRect();
    setDrag({
      startX: e.clientX,
      startY: e.clientY,
      startSpan: span,
      startHeight: cell.getBoundingClientRect().height,
      parentWidth: parentRect.width,
    });
  }

  useEffectT(() => {
    if (!drag) return;
    function onMove(e) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      // 12-col grid: one column = parentWidth / 12. Snap to nearest column.
      const colPx = drag.parentWidth / 12;
      const colDelta = Math.round(dx / colPx);
      const newSpan = Math.max(3, Math.min(12, drag.startSpan + colDelta));
      const newHeight = Math.max(120, drag.startHeight + dy);
      onResize && onResize({ span: newSpan, height: newHeight });
    }
    function onUp() { setDrag(null); }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [drag, onResize]);

  const enhanced = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && child.type && child.type.name === 'Region') {
      return React.cloneElement(child, { height });
    }
    return child;
  });

  return (
    <div ref={cellRef} className={`tm-cell c-${span} ${drag ? 'is-resizing' : ''}`} data-cell-id={id}>
      {enhanced}
      <span
        className="tm-cell-grip"
        onPointerDown={onGripDown}
        title="drag to resize (width snaps to grid columns · sibling adjusts)"
      >⋰</span>
    </div>
  );
}
window.GridCell = GridCell;

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
