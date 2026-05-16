'use client';
import {
  useState as useStateT,
  useRef as useRefT,
  useEffect as useEffectT,
  useMemo as useMemoT,
  Children,
  isValidElement,
  cloneElement,
} from 'react';

// ── Number formatting ─────────────────────────────────────────────────────
export const fmt = {
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

// ── Brand mark ────────────────────────────────────────────────────────────
export function BeaconMark({ size = 32 }) {
  return (
    <svg className="tm-beacon" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" strokeWidth="2"/>
      <line x1="8" y1="32" x2="56" y2="32" stroke="currentColor" strokeWidth="2"/>
      <ellipse className="meridian" cx="32" cy="32" rx="10" ry="24" fill="none" stroke="currentColor" strokeWidth="2"/>
      <ellipse cx="32" cy="32" rx="24" ry="10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.55"/>
      <circle className="ring-b" cx="44" cy="22" r="4" fill="none" stroke="currentColor" strokeWidth="1"/>
      <circle className="ring-a" cx="44" cy="22" r="4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      <circle className="beacon-dot" cx="44" cy="22" r="4" fill="currentColor"/>
    </svg>
  );
}

// ── Block-char bar ────────────────────────────────────────────────────────
export function blockBar(v, max, width = 28) {
  const filled = Math.max(0, Math.min(1, v / max)) * width;
  const whole = Math.floor(filled);
  const frac = filled - whole;
  const partials = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
  const pIdx = Math.min(7, Math.round(frac * 8));
  return '█'.repeat(whole) + partials[pIdx] + ' '.repeat(Math.max(0, width - whole - (pIdx ? 1 : 0)));
}

// ── Shell ─────────────────────────────────────────────────────────────────
const THEMES = [
  { id: 'purple', dot: '#a674ff' },
  { id: 'amber',  dot: '#ffb000' },
  { id: 'green',  dot: '#4ade80' },
  { id: 'paper',  dot: '#f7f3e8' },
];

function TweaksPanel({ theme, onThemeChange, notifPrefs, onNotifChange, onClose, btnRef }) {
  const ref = useRefT(null);
  useEffectT(() => {
    function down(e) {
      if (ref.current?.contains(e.target) || btnRef?.current?.contains(e.target)) return;
      onClose();
    }
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [onClose]);

  const sectionLbl = { color: 'var(--t-fg-mut)', fontSize: 9, letterSpacing: '0.1em', marginBottom: 8 };

  return (
    <div ref={ref} style={{
      position: 'fixed', top: 28, right: 0, zIndex: 10000,
      background: 'var(--t-bg)', border: '1px solid var(--t-rule)', borderTop: 'none',
      padding: '12px 14px', fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs)',
      minWidth: 188, boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
    }}>
      <div style={sectionLbl}>THEME</div>
      {THEMES.map(th => (
        <button key={th.id} onClick={() => onThemeChange(th.id)} style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0',
          color: theme === th.id ? 'var(--t-fg)' : 'var(--t-fg-mut)',
          fontFamily: 'var(--t-font)', fontSize: 'var(--t-fs)', textAlign: 'left',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: 1, flexShrink: 0, background: th.dot,
            boxShadow: theme === th.id
              ? `0 0 0 2px var(--t-bg), 0 0 0 3px ${th.dot}`
              : '0 0 0 1px rgba(255,255,255,0.12)',
          }} />
          {th.id}
          {theme === th.id && <span style={{ marginLeft: 'auto', color: 'var(--t-fg-dim)', fontSize: 9 }}>◆</span>}
        </button>
      ))}

      {notifPrefs && onNotifChange && (
        <>
          <div style={{ borderTop: '1px solid var(--t-rule)', margin: '10px 0 8px' }} />
          <div style={sectionLbl}>NOTIFICATIONS</div>
          {Object.entries(notifPrefs).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ color: 'var(--t-fg-soft)' }}>{k}</span>
              <button onClick={() => onNotifChange({ ...notifPrefs, [k]: !v })} style={{
                background: v ? 'var(--t-pos)' : 'none',
                border: `1px solid ${v ? 'var(--t-pos)' : 'var(--t-rule)'}`,
                color: v ? 'var(--t-bg)' : 'var(--t-fg-dim)',
                fontFamily: 'var(--t-font)', fontSize: 9, letterSpacing: '0.08em',
                padding: '1px 7px', cursor: 'pointer',
              }}>
                {v ? 'ON' : 'OFF'}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function TerminalShell({ apps, activeAppId, onAppChange, ticker, tabs, activeTab, onTabChange, search, onSearch, fkeys, sideFooter, children, rail, clock, theme = 'purple', density = 'regular', mode = 'standalone', nav, brand, sideContent, railLabel = 'criminal', onThemeChange, notifPrefs, onNotifChange, openRailRef }) {
  const [now, setNow] = useStateT(clock || nowUTC());
  const [activeSection, setActiveSection] = useStateT(nav && nav[0] ? nav[0].id : null);
  const [railOpen, setRailOpen] = useStateT(false);
  useEffectT(() => { if (openRailRef) openRailRef.current = () => setRailOpen(true); }, [openRailRef]);
  const [sideOpen, setSideOpen] = useStateT(() =>
    typeof window === 'undefined' ? true : window.innerWidth > 720
  );
  const [settingsOpen, setSettingsOpen] = useStateT(false);
  const [tickerTooltip, setTickerTooltip] = useStateT(null);
  const settingsBtnRef = useRefT(null);
  useEffectT(() => {
    if (clock) return;
    const t = setInterval(() => setNow(nowUTC()), 1000);
    return () => clearInterval(t);
  }, [clock]);

  useEffectT(() => {
    if (mode !== 'standalone' || !nav) return;
    const root = document.querySelector('.tm-main-scroll');
    if (!root) return;
    const targets = nav.map((n) => document.getElementById(`sec-${n.id}`)).filter(Boolean);
    if (!targets.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
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
    <div className="tm" data-theme={theme} data-density={density} data-mode={mode}
      style={{ gridTemplateColumns: sideOpen ? '192px 1fr' : '50px 1fr', transition: 'grid-template-columns 0.18s ease' }}>
      <div className="tm-ticker">
        {(ticker || []).map((c, i) => (
          <span
            className="tm-ticker-cell"
            key={i}
            onMouseEnter={c.tooltip ? e => setTickerTooltip({ idx: i, rect: e.currentTarget.getBoundingClientRect() }) : undefined}
            onMouseLeave={c.tooltip ? () => setTickerTooltip(null) : undefined}
          >
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
          <>
            <button
              ref={settingsBtnRef}
              onClick={() => setSettingsOpen(o => !o)}
              title="tweaks"
              style={{
                background: settingsOpen ? 'var(--t-fg)' : 'var(--t-bg-soft)',
                color: settingsOpen ? 'var(--t-bg)' : 'var(--t-fg)',
                border: settingsOpen ? '1px solid var(--t-fg)' : '1px solid var(--t-fg-soft)',
                fontFamily: 'var(--t-font)', fontSize: 11,
                padding: '0 9px', cursor: 'pointer',
                letterSpacing: '0.06em', height: 18,
                display: 'inline-flex', alignItems: 'center',
                marginLeft: 6,
              }}
            >
              ⚙
            </button>
            {settingsOpen && (
              <TweaksPanel
                theme={theme}
                onThemeChange={onThemeChange}
                notifPrefs={notifPrefs}
                onNotifChange={onNotifChange}
                onClose={() => setSettingsOpen(false)}
                btnRef={settingsBtnRef}
              />
            )}
          </>
        ) : null}
      </div>

      <aside className="tm-side">
        <div className="tm-side-body">
          <div
            className="tm-side-h"
            onClick={() => setSideOpen((o) => !o)}
            style={{ cursor: 'pointer', padding: sideOpen ? undefined : '8px 10px' }}
            title={sideOpen ? 'collapse' : 'expand'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: sideOpen ? 4 : 0 }}>
              <BeaconMark size={30} />
              {sideOpen && (
                <div>
                  <div className="tm-side-mark">{brand?.name || 'OFFSHORE'}<em>·</em></div>
                  <div className="tm-side-sub">{brand?.sub || 'dashboard · v0.3'}</div>
                </div>
              )}
            </div>
          </div>

          {sideOpen && (sideContent ? (
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
          ))}

          {sideOpen && (
            <div className="tm-side-foot">
              {(sideFooter || []).map((row, i) => (
                <div key={i} className="row"><span>{row.k}</span><b className={row.cls || ''}>{row.v}</b></div>
              ))}
            </div>
          )}
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

      {tickerTooltip && (ticker || [])[tickerTooltip.idx]?.tooltip && (
        <div style={{
          position: 'fixed',
          top: tickerTooltip.rect.bottom + 2,
          left: tickerTooltip.rect.left,
          zIndex: 9999,
          pointerEvents: 'none',
        }}>
          {(ticker || [])[tickerTooltip.idx].tooltip}
        </div>
      )}
    </div>
  );
}

function nowUTC() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const short = tz.split('/').pop().replace(/_/g, ' ');
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())} ${short}`;
}

// ── Region ────────────────────────────────────────────────────────────────
export function Region({ title, sub, fkey, actions, focus, children, headRight, endControls, height, fill }) {
  const style = height ? { height: typeof height === 'number' ? `${height}px` : height } : fill ? { display: 'flex', flexDirection: 'column', flex: 1 } : undefined;
  const bodyStyle = fill ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined;
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
      <div className="tm-region-body" style={bodyStyle}>{children}</div>
    </div>
  );
}

// ── Stats grid ────────────────────────────────────────────────────────────
export function Stats({ items, cols }) {
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

// ── KV row ────────────────────────────────────────────────────────────────
export function KV({ k, v, cls, sub }) {
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
export function KVSep() { return <div className="tm-kv-sep" />; }

// ── Single-series bar row ─────────────────────────────────────────────────
// Measures the pixel width of a glyph span and returns how many block chars fit.
function useContainerSize(ref) {
  const [size, setSize] = useStateT({ w: 0, h: 0 });
  useEffectT(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}

function useGlyphWidth(ref, fallback = 28) {
  const [w, setW] = useStateT(fallback);
  useEffectT(() => {
    const el = ref.current;
    if (!el) return;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;pointer-events:none';
    probe.textContent = '█';
    el.appendChild(probe);
    const charPx = probe.getBoundingClientRect().width || 7.2;
    el.removeChild(probe);
    const update = () => {
      const px = ref.current?.getBoundingClientRect().width ?? 0;
      if (px > 0) setW(Math.max(4, Math.floor(px / charPx)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

function ChartTooltip({ mouse, title, rows }) {
  if (typeof window === 'undefined') return null;
  const flipX = mouse.x + 180 > window.innerWidth;
  const flipY = mouse.y > window.innerHeight * 0.7;
  return (
    <div className="tm-tt" style={{
      position: 'fixed', zIndex: 9999,
      ...(flipX ? { right: window.innerWidth - mouse.x + 12 } : { left: mouse.x + 12 }),
      ...(flipY ? { bottom: window.innerHeight - mouse.y + 12 } : { top: mouse.y + 8 }),
    }}>
      {title != null && (
        <div className="tm-tt-row" style={{ paddingBottom: 3, marginBottom: 3, borderBottom: '1px solid var(--t-rule)' }}>
          <span className="tm-tt-k" style={{ fontWeight: 700 }}>{title}</span>
        </div>
      )}
      {rows.map((r, i) => (
        <div className="tm-tt-row" key={i}>
          {r.color && (
            <span style={{
              display: 'inline-block', width: 6, height: 6,
              background: r.color, borderRadius: 1,
              marginRight: 5, verticalAlign: 'middle', flexShrink: 0,
            }} />
          )}
          <span className="tm-tt-k">{r.k}</span>
          {r.v != null && (
            <span className="tm-tt-v" style={{ color: r.color || undefined }}>{r.v}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function BarRow({ data, max, color = 'fg', valueFmt = fmt.k }) {
  const m = max || Math.max(...data.map((d) => d.v), 1);
  const [hoverD, setHoverD] = useStateT(null);
  const [mouse, setMouse] = useStateT({ x: 0, y: 0 });
  return (
    <>
      {data.map((d) => (
        <div className="tm-barrow" key={d.x}
          onMouseEnter={(e) => { setHoverD(d); setMouse({ x: e.clientX, y: e.clientY }); }}
          onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setHoverD(null)}
        >
          <span className="lbl">{d.x}</span>
          <span className="tm-bar-scroll">
            <span className="tm-track">
              <i className={color === 'fg' ? '' : color} style={{ width: `${(d.v / m) * 100}%` }} />
            </span>
          </span>
          <span className="num">{valueFmt(d.v)}</span>
        </div>
      ))}
      {hoverD && (
        <ChartTooltip
          mouse={mouse}
          title={hoverD.x}
          rows={[{ k: 'value', v: valueFmt(hoverD.v), color: `var(--t-${color})` }]}
        />
      )}
    </>
  );
}

// ── Two-series bar row ─────────────────────────────────────────────────────
export function BarRow2({ data, series, max, valueFmt = fmt.k, hideNum = false }) {
  const scrollRef = useRefT(null);
  const width = useGlyphWidth(scrollRef);
  const halfW = Math.max(1, Math.floor(width / 2));
  const m = max || Math.max(...data.flatMap((d) => series.map((s) => d[s.key] || 0)), 1);
  const [hoverD, setHoverD] = useStateT(null);
  const [mouse, setMouse] = useStateT({ x: 0, y: 0 });
  return (
    <>
      {data.map((d, i) => (
        <div className="tm-barrow-2" key={d.x ?? i}
          style={hideNum ? { gridTemplateColumns: '56px 1fr' } : undefined}
          onMouseEnter={(e) => { setHoverD(d); setMouse({ x: e.clientX, y: e.clientY }); }}
          onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setHoverD(null)}
        >
          <span className="lbl">{d.x ?? d.t}</span>
          <span className="tm-bar-scroll" ref={i === 0 ? scrollRef : null}>
            {series.map((s) => (
              <span key={s.key}
                className={`glyphs ${s.color}${s.dir === 'rtl' ? ' rtl' : ''}`} title={s.label}>
                {blockBar(d[s.key] || 0, m, halfW)}
              </span>
            ))}
          </span>
          {!hideNum && (
            <span className="num">
              <span className={series[0].color}>{valueFmt(d[series[0].key] || 0)}</span>
              {' · '}
              <span className={series[1].color}>{valueFmt(d[series[1].key] || 0)}</span>
            </span>
          )}
        </div>
      ))}
      {hoverD && (
        <ChartTooltip
          mouse={mouse}
          title={hoverD.x ?? hoverD.t}
          rows={series.map(s => ({
            k: s.label || s.key,
            v: valueFmt(hoverD[s.key] || 0),
            color: `var(--t-${s.color})`,
          }))}
        />
      )}
    </>
  );
}

// ── Stacked bar row ────────────────────────────────────────────────────────
export function StackedBarRow({ data, series, max, valueFmt = fmt.k, hideNum = false }) {
  const containerRef = useRefT(null);
  const scrollRef = useRefT(null);
  const width = useGlyphWidth(scrollRef);
  const { w: pxWidth } = useContainerSize(containerRef);
  const visData = pxWidth > 0 && pxWidth < 480 ? data.slice(-12) : data;
  const totals = visData.map((d) => series.reduce((s, k) => s + (d[k.key] || 0), 0));
  const m = max || Math.max(...totals, 1);
  const [hoverD, setHoverD] = useStateT(null);
  const [mouse, setMouse] = useStateT({ x: 0, y: 0 });
  return (
    <div ref={containerRef}>
      {visData.map((d, i) => {
        const total = totals[i];
        const totalChars = Math.round((total / m) * width);
        let remaining = totalChars;
        const charCounts = series.map((s, si) => {
          if (si === series.length - 1) return remaining;
          const c = total > 0 ? Math.round((d[s.key] || 0) / total * totalChars) : 0;
          remaining -= c;
          return c;
        });
        return (
          <div className="tm-blockrow" key={d.x ?? i}
            style={hideNum ? { gridTemplateColumns: 'var(--tm-bar-lbl, 56px) 1fr' } : undefined}
            onMouseEnter={(e) => { setHoverD(d); setMouse({ x: e.clientX, y: e.clientY }); }}
            onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHoverD(null)}
          >
            <span className="lbl">{d.x ?? d.t}</span>
            <span className="tm-bar-scroll" ref={i === 0 ? scrollRef : null}>
              <span className="glyphs">
                {series.map((s, si) => (
                  <span key={s.key} style={{ color: `var(--t-${s.colorVar || s.color})` }}>
                    {'█'.repeat(Math.max(0, charCounts[si]))}
                  </span>
                ))}
                {' '.repeat(Math.max(0, width - totalChars))}
              </span>
            </span>
            {!hideNum && <span className="num">{valueFmt(total)}</span>}
          </div>
        );
      })}
      {hoverD && (
        <ChartTooltip
          mouse={mouse}
          title={hoverD.x ?? hoverD.t}
          rows={series.filter(s => hoverD[s.key]).map(s => ({
            k: s.label || s.key,
            v: valueFmt(hoverD[s.key]),
            color: `var(--t-${s.colorVar || s.color})`,
          }))}
        />
      )}
    </div>
  );
}

// ── Block-char row ─────────────────────────────────────────────────────────
export function BlockRow({ data, max, color = '', valueFmt = fmt.k }) {
  const scrollRef = useRefT(null);
  const width = useGlyphWidth(scrollRef);
  const m = max || Math.max(...data.map((d) => d.v), 1);
  return (
    <>
      {data.map((d, i) => (
        <div className="tm-blockrow" key={d.x}>
          <span className="lbl">{d.x}</span>
          <span className="tm-bar-scroll" ref={i === 0 ? scrollRef : null}>
            <span className={`glyphs ${color}`}>{blockBar(d.v, m, width)}</span>
          </span>
          <span className="num">{valueFmt(d.v)}</span>
        </div>
      ))}
    </>
  );
}

// ── ASCII vertical bar chart ──────────────────────────────────────────────
// series can have stackOn:'baseKey' to stack on top of another series.
export function AsciiBarChart({ data, series, height = 14, valueFmt = fmt.k }) {
  const containerRef = useRefT(null);
  const charWidth    = useGlyphWidth(containerRef, 60);
  const { w: pxWidth } = useContainerSize(containerRef);
  const [hoverIdx, setHoverIdx] = useStateT(null);
  const [mouse, setMouse] = useStateT({ x: 0, y: 0 });

  // Build stacked column groups
  const groups = [];
  const groupByKey = {};
  for (const s of series) {
    if (s.stackOn && groupByKey[s.stackOn]) {
      groupByKey[s.stackOn].push(s);
    } else {
      const g = [s];
      groups.push(g);
      groupByKey[s.key] = g;
    }
  }

  const yAxisW  = 5;
  const barsW   = Math.max(groups.length + 1, charWidth - yAxisW - 2);

  // Maximum points at minimum bar width (1 char per bar + 1 gap)
  const maxPoints = Math.floor(barsW / (groups.length + 1));
  const densityCap = pxWidth > 0 && pxWidth < 480 ? 12 : data.length;
  const nPoints   = Math.min(data.length, maxPoints, densityCap);

  // Widen bars to fill available space
  const barW           = nPoints > 0 ? Math.max(1, Math.floor((barsW - nPoints) / (nPoints * groups.length))) : 1;
  const charsPerPeriod = groups.length * barW + 1;    // bars + 1 gap

  const visData = data.slice(-nPoints);

  if (!visData.length) return <div ref={containerRef} />;

  const maxVal = Math.max(
    ...visData.map(d => Math.max(...groups.map(g => g.reduce((s, b) => s + (d[b.key] || 0), 0)))),
    1,
  );
  const step    = niceStep(maxVal / 4);
  const topTick = Math.ceil(maxVal / step) * step;

  // Map row index → tick value for Y-axis labels
  const tickRowMap = new Map();
  for (let t = 0; t <= topTick; t += step) {
    tickRowMap.set(Math.round((t / topTick) * (height - 1)), t);
  }

  // Build grid rows (top = height-1, bottom = 0)
  const rows = [];
  for (let r = height - 1; r >= 0; r--) {
    const tickVal = tickRowMap.get(r);
    const yLabel  = (tickVal != null ? valueFmt(tickVal) : '').padStart(yAxisW);
    const axisChar = tickVal != null ? '┤' : '│';
    const cells = [];

    for (const d of visData) {
      for (const grp of groups) {
        const totalRows = Math.round(grp.reduce((s, b) => s + (d[b.key] || 0), 0) / topTick * height);
        if (r >= totalRows) {
          cells.push({ color: null, w: barW });
        } else {
          let cumRows = 0;
          let color   = grp[0].color;
          for (const seg of grp) {
            cumRows += Math.round((d[seg.key] || 0) / topTick * height);
            if (r < cumRows) { color = seg.color; break; }
          }
          cells.push({ color, w: barW });
        }
      }
      cells.push({ color: null, w: 1 }); // gap
    }
    rows.push({ yLabel, axisChar, cells });
  }

  // X-axis label string
  const labelStep = Math.max(1, Math.ceil(nPoints / 6));
  const xArr = Array(nPoints * charsPerPeriod).fill(' ');
  for (let di = 0; di < nPoints; di += labelStep) {
    const lbl = String(visData[di]?.label || visData[di]?.x || '');
    const pos = di * charsPerPeriod;
    for (let ci = 0; ci < lbl.length && pos + ci < xArr.length; ci++) {
      xArr[pos + ci] = lbl[ci];
    }
  }

  return (
    <div ref={containerRef} style={{ fontSize: 'var(--t-fs)', lineHeight: 1.35, userSelect: 'none', overflow: 'hidden', position: 'relative' }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', whiteSpace: 'pre' }}>
          <span className="tm-chart-axis" style={{ minWidth: `${yAxisW}ch` }}>{row.yLabel}</span>
          <span style={{ color: 'var(--t-fg-dim)' }}>{row.axisChar}</span>
          {row.cells.map((cell, ci) =>
            cell.color
              ? <span key={ci} style={{ color: `var(--t-${cell.color})` }}>{'█'.repeat(cell.w)}</span>
              : <span key={ci}>{' '.repeat(cell.w)}</span>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', whiteSpace: 'pre' }}>
        <span style={{ minWidth: `${yAxisW}ch` }} />
        <span style={{ color: 'var(--t-fg-dim)' }}>{'└' + '─'.repeat(nPoints * charsPerPeriod)}</span>
      </div>
      <div className="tm-chart-axis" style={{ whiteSpace: 'pre', paddingLeft: `${yAxisW + 1}ch` }}>
        {xArr.join('')}
      </div>

      {/* column highlight */}
      {hoverIdx != null && (
        <div style={{
          position: 'absolute',
          left: `${yAxisW + 1 + hoverIdx * charsPerPeriod}ch`,
          width: `${groups.length * barW}ch`,
          top: 0,
          height: `${height * 1.35}em`,
          background: 'var(--t-fg)',
          opacity: 0.08,
          pointerEvents: 'none',
        }} />
      )}

      {/* invisible hit zones per column */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
        {visData.map((d, di) => (
          <div key={di} style={{
            position: 'absolute',
            left: `${yAxisW + 1 + di * charsPerPeriod}ch`,
            width: `${charsPerPeriod}ch`,
            top: 0, bottom: 0,
            pointerEvents: 'auto',
            cursor: 'crosshair',
          }}
            onMouseEnter={(e) => { setHoverIdx(di); setMouse({ x: e.clientX, y: e.clientY }); }}
            onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}
      </div>

      {hoverIdx != null && (() => {
        const d = visData[hoverIdx];
        return (
          <ChartTooltip
            mouse={mouse}
            title={d.label ?? d.x ?? d.t ?? String(hoverIdx + 1)}
            rows={series.map(s => ({
              k: s.label || s.key,
              v: valueFmt(d[s.key] || 0),
              color: `var(--t-${s.color})`,
            }))}
          />
        );
      })()}
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────
export function MultiSpark({ series, labels }) {
  const containerRef = useRefT(null);
  const { w, h } = useContainerSize(containerRef);
  const [hoverIdx, setHoverIdx] = useStateT(null);
  const [mouse, setMouse] = useStateT({ x: 0, y: 0 });

  const PAD_L = 28, PAD_R = 4, PAD_T = 4, PAD_B = 16;
  const cW = Math.max(1, w - PAD_L - PAD_R);
  const cH = Math.max(1, h - PAD_T - PAD_B);

  const allVals = series.flatMap(s => s.data);
  const max     = Math.max(...allVals, 1);
  const min     = Math.min(...allVals, 0);
  const range   = max - min || 1;
  const longest = Math.max(...series.map(s => s.data.length), 2);

  function pts(data) {
    return data.map((v, i) => {
      const x = PAD_L + (i / (longest - 1)) * cW;
      const y = PAD_T + cH - ((v - min) / range) * cH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }
  function getX(i) { return PAD_L + (i / (longest - 1)) * cW; }
  function getY(v) { return PAD_T + cH - ((v - min) / range) * cH; }

  function handleMouseMove(e) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || w === 0) return;
    const relX = e.clientX - rect.left;
    const frac = (relX - PAD_L) / cW;
    const idx  = Math.round(frac * (longest - 1));
    setHoverIdx(Math.max(0, Math.min(longest - 1, idx)));
    setMouse({ x: e.clientX, y: e.clientY });
  }

  return (
    <div ref={containerRef}
      style={{ flex: 1, minHeight: 0, position: 'relative', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {w > 0 && h > 0 && (
        <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
          {[0, 0.5, 1].map(t => {
            const y   = PAD_T + cH * (1 - t);
            const val = min + range * t;
            return (
              <g key={t}>
                <line x1={PAD_L} y1={y} x2={w - PAD_R} y2={y}
                  stroke="var(--t-fg-mut)" strokeOpacity="0.18" strokeDasharray="2 3" />
                <text x={PAD_L - 3} y={y + 3} textAnchor="end"
                  fill="var(--t-fg-soft)" fontSize="9" fontFamily="var(--t-font)">
                  {fmt.k(val)}
                </text>
              </g>
            );
          })}
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + cH}
            stroke="var(--t-fg-mut)" strokeOpacity="0.3" />
          {series.map(s => (
            <polyline key={s.label} points={pts(s.data)}
              fill="none" stroke={s.color} strokeWidth="1.25" strokeLinejoin="round" />
          ))}
          {/* crosshair + dots */}
          {hoverIdx != null && w > 0 && (
            <g>
              <line
                x1={getX(hoverIdx)} y1={PAD_T}
                x2={getX(hoverIdx)} y2={PAD_T + cH}
                stroke="var(--t-fg-mut)" strokeOpacity="0.45" strokeDasharray="3 2"
              />
              {series.map(s => {
                const v = s.data[hoverIdx];
                if (v == null) return null;
                return (
                  <circle key={s.label}
                    cx={getX(hoverIdx)} cy={getY(v)} r={3}
                    fill={s.color} stroke="var(--t-bg)" strokeWidth="1"
                  />
                );
              })}
            </g>
          )}
          {series.map((s, i) => {
            const lx = PAD_L + (cW / series.length) * i;
            return (
              <g key={s.label} transform={`translate(${lx},${h - 5})`}>
                <line x1={0} y1={0} x2={8} y2={0} stroke={s.color} strokeWidth="1.5" />
                <text x={11} y={4} fill="var(--t-fg-soft)" fontSize="9" fontFamily="var(--t-font)">{s.label}</text>
              </g>
            );
          })}
        </svg>
      )}
      {hoverIdx != null && (
        <ChartTooltip
          mouse={mouse}
          title={labels?.[hoverIdx] ?? `day ${hoverIdx + 1}`}
          rows={series.map(s => ({
            k: s.label,
            v: fmt.k(s.data[hoverIdx] ?? 0),
            color: s.color,
          }))}
        />
      )}
    </div>
  );
}

export function Spark({ data, w = 80, h = 20, color = 'var(--t-fg)' }) {
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
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Heatmap ────────────────────────────────────────────────────────────────
const HEAT_MIX = [5, 18, 36, 56, 76, 100]; // % of --t-fg in --t-bg per intensity level
const CELL_H   = 14; // px — fixed cell height; flex width determines shape

export function Heatmap({ grid, days, max }) {
  const m = max || Math.max(...grid.flat(), 1);
  const wrapRef = useRefT(null);
  const { w: measuredW } = useContainerSize(wrapRef);
  const [hover, setHover] = useStateT(null);
  const [mouse, setMouse] = useStateT({ x: 0, y: 0 });

  function intensity(v) {
    if (v === 0) return 0;
    return Math.max(1, Math.min(HEAT_MIX.length - 1, Math.ceil((v / m) * (HEAT_MIX.length - 1))));
  }

  // Pixel-grid discipline: measure container, derive an INTEGER cell width
  // that fits 24 hours flush. Replaces `flex: 1` cells whose subpixel rounding
  // produced uneven stripes when the panel resized.
  const LABEL_W = 38;
  const GAP = 1;
  const HOURS = 24;
  const avail = Math.max(0, (measuredW || 480) - LABEL_W - (HOURS - 1) * GAP);
  const cellW = Math.max(6, Math.floor(avail / HOURS));
  const rowsW = LABEL_W + HOURS * cellW + (HOURS - 1) * GAP;

  const rowStyle   = { display: 'flex', alignItems: 'center', gap: GAP, marginBottom: 1 };
  const labelStyle = { width: LABEL_W, flexShrink: 0, color: 'var(--t-fg-soft)', fontSize: 'var(--t-fs-sm)' };

  return (
    <div ref={wrapRef} style={{ fontFamily: 'var(--t-font)', userSelect: 'none' }}>
      {grid.map((row, di) => (
        <div key={di} style={rowStyle}>
          <span style={labelStyle}>{days[di]}</span>
          {row.map((v, hi) => {
            const ci = intensity(v);
            const isHov = hover?.di === di && hover?.hi === hi;
            const color = isHov
              ? 'var(--t-hdr)'
              : `color-mix(in srgb, var(--t-fg) ${HEAT_MIX[ci]}%, var(--t-bg))`;
            return (
              <div key={hi} style={{
                width: cellW, flex: '0 0 auto', height: CELL_H, overflow: 'hidden',
                fontSize: CELL_H, lineHeight: `${CELL_H}px`,
                whiteSpace: 'nowrap', color,
                cursor: 'crosshair',
              }}
                onMouseEnter={(e) => { setHover({ di, hi, v }); setMouse({ x: e.clientX, y: e.clientY }); }}
                onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
              >{'█'.repeat(12)}</div>
            );
          })}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: GAP, marginTop: 2, width: rowsW }}>
        <span style={{ width: LABEL_W, flexShrink: 0 }} />
        {Array.from({ length: HOURS }, (_, h) => (
          <span key={h} style={{ width: cellW, flex: '0 0 auto', textAlign: 'center', color: 'var(--t-fg-soft)', fontSize: 'var(--t-fs-sm)' }}>
            {h % 6 === 0 ? String(h).padStart(2, '0') : ''}
          </span>
        ))}
      </div>
      {hover && (
        <ChartTooltip
          mouse={mouse}
          title={`${days[hover.di]}  ${String(hover.hi).padStart(2, '0')}:00`}
          rows={[{ k: 'ops', v: String(hover.v) }]}
        />
      )}
    </div>
  );
}

// ── Segmented control ─────────────────────────────────────────────────────
export function Seg({ value, options, onChange }) {
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

// ── Sortable header ────────────────────────────────────────────────────────
export function Sortable({ label, k, sortKey, sortDir, on }) {
  return (
    <button className={`tm-sort ${sortKey === k ? 'on' : ''}`} onClick={() => on(k)}>
      {label}
      <span className="tm-sort-caret">{sortKey === k ? (sortDir === 'asc' ? '▴' : '▾') : '↕'}</span>
    </button>
  );
}

// ── ComboChart ─────────────────────────────────────────────────────────────
// bars: array of { key, label, color, stackOn? }
//   bars with stackOn:'baseKey' are stacked on top of the named base bar.
//   all other bars are side-by-side columns.
export function ComboChart({ data, bars, line, height = 220 }) {
  const wrapRef = useRefT(null);
  const { w: measuredW } = useContainerSize(wrapRef);
  const [hoverIdx, setHoverIdx] = useStateT(null);
  const [mouse, setMouse] = useStateT({ x: 0, y: 0 });

  // Render the SVG in NATIVE PIXEL SPACE: viewBox width == container width,
  // so every viewBox unit is exactly one rendered pixel. Combined with
  // Math.round() on bar coords and shape-rendering:crispEdges, bars stay
  // pixel-snapped through resize. Falls back to 1000 on the very first frame
  // (before ResizeObserver fires) — single-frame transient, invisible.
  const W = Math.max(320, Math.round(measuredW || 1000)), H = height;
  const PAD_L = 44, PAD_R = 44, PAD_T = 10, PAD_B = 24;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const groupW = plotW / data.length;

  // Build column groups: each group is a stack [base, ...extras]
  const groups = [];
  const groupByKey = {};
  for (const b of bars) {
    if (b.stackOn && groupByKey[b.stackOn]) {
      groupByKey[b.stackOn].push(b);
    } else {
      const g = [b];
      groups.push(g);
      groupByKey[b.key] = g;
    }
  }
  const nCols = groups.length;
  const barPad = groupW * 0.1;
  const colGap = nCols > 1 ? groupW * 0.04 : 0;
  const colW   = (groupW - barPad * 2 - colGap * (nCols - 1)) / nCols;

  // Bar axis max = tallest stacked column across all data points
  const barMax = Math.max(
    ...data.map(d => groups.reduce((m, g) => Math.max(m, g.reduce((s, b) => s + (d[b.key] || 0), 0)), 0)),
    1,
  );
  const barStep = niceStep(barMax / 4);
  const barTicks = [];
  for (let v = 0; v <= barMax * 1.1; v += barStep) barTicks.push(v);
  const barTop = barTicks[barTicks.length - 1];

  const lineVals = data.map((d) => d[line.key] || 0);
  const lineAbs  = Math.max(...lineVals.map(Math.abs), 1);
  const lineStep = niceStep(lineAbs / 3);
  const lineTop  = Math.ceil(lineAbs / lineStep) * lineStep;
  const lineTicks = [-lineTop, -lineTop / 2, 0, lineTop / 2, lineTop];

  const linePts = data.map((d, i) => [
    PAD_L + groupW * i + groupW / 2,
    PAD_T + plotH / 2 - ((d[line.key] || 0) / lineTop) * (plotH / 2),
  ]);

  function onMove(e) {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - r.left) / r.width) * W;
    const idx = Math.floor((svgX - PAD_L) / groupW);
    setHoverIdx(idx >= 0 && idx < data.length ? idx : null);
    setMouse({ x: e.clientX, y: e.clientY });
  }

  const hovered = hoverIdx != null ? data[hoverIdx] : null;

  return (
    <div className="tm-svg-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ fontFamily: 'var(--t-font)', fontWeight: 400 }}>
        {/* grid + left axis */}
        {barTicks.map((t, i) => {
          const y = PAD_T + plotH - (t / barTop) * plotH;
          return (
            <g key={i}>
              <line className="tm-svg-grid" x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} />
              <text className="tm-svg-axis" x={PAD_L - 4} y={y + 3} textAnchor="end">{fmt.k(t)}</text>
            </g>
          );
        })}
        {/* right axis */}
        {lineTicks.map((t, i) => {
          const y = PAD_T + plotH / 2 - (t / lineTop) * (plotH / 2);
          return <text key={i} className="tm-svg-axis" x={W - PAD_R + 4} y={y + 3} textAnchor="start">{fmt.k(t)}</text>;
        })}
        {/* hover column highlight */}
        {hoverIdx != null && (
          <rect x={PAD_L + groupW * hoverIdx} y={PAD_T} width={groupW} height={plotH} fill="var(--t-fg)" opacity={0.06} />
        )}
        {/* stacked bar groups */}
        {data.map((d, i) => (
          <g key={i}>
            {groups.map((grp, gi) => {
              const x = PAD_L + groupW * i + barPad + gi * (colW + colGap);
              let yBottom = PAD_T + plotH;
              return grp.map((b) => {
                const bh = ((d[b.key] || 0) / barTop) * plotH;
                const y = yBottom - bh;
                yBottom -= bh;
                const rx = Math.round(x);
                const rw = Math.max(2, Math.round(colW));
                const ry = Math.round(y);
                const rh = Math.max(1, Math.round(bh));
                return (
                  <rect
                    key={b.key}
                    x={rx} y={ry} width={rw} height={rh}
                    fill={`var(--t-${b.color})`}
                    opacity={hoverIdx == null || hoverIdx === i ? 1 : 0.45}
                    shapeRendering="crispEdges"
                  />
                );
              });
            })}
          </g>
        ))}
        {/* line */}
        <polyline
          points={linePts.map((p) => `${(Math.round(p[0] * 2) / 2)},${(Math.round(p[1] * 2) / 2)}`).join(' ')}
          fill="none" stroke={`var(--t-${line.color})`} strokeWidth="1.75"
          strokeLinejoin="miter" strokeLinecap="square"
        />
        {linePts.map((p, i) => (
          <circle key={i} cx={Math.round(p[0])} cy={Math.round(p[1])} r={hoverIdx === i ? 3.5 : 2.2} fill={`var(--t-${line.color})`} />
        ))}
        {/* x labels */}
        {data.map((d, i) => i % Math.ceil(data.length / 9) === 0 ? (
          <text key={i} className="tm-svg-axis" x={PAD_L + groupW * (i + 0.5)} y={H - 6} textAnchor="middle">{d.label || d.x}</text>
        ) : null)}
      </svg>

      {hovered && (() => {
        const flipX = mouse.x + 180 > window.innerWidth;
        const flipY = mouse.y > window.innerHeight * 0.7;
        return (
          <div className="tm-tt" style={{
            position: 'fixed', zIndex: 9999,
            ...(flipX ? { right: window.innerWidth  - mouse.x + 12 } : { left: mouse.x + 12 }),
            ...(flipY ? { bottom: window.innerHeight - mouse.y + 12 } : { top: mouse.y + 8 }),
          }}>
            {bars.map((b) => (
              <div className="tm-tt-row" key={b.key}>
                <span className="k">{b.label}</span>
                <span className={`v tm-${b.color}`}>{fmt.k(hovered[b.key] || 0)}</span>
              </div>
            ))}
            <div className="tm-tt-row">
              <span className="k">{line.label}</span>
              <span className={`v tm-${line.color}`}>{fmt.signed(hovered[line.key] || 0)}</span>
            </div>
            <div className="tm-tt-row" style={{ marginTop: 4, borderTop: '1px dotted var(--t-rule)', paddingTop: 4 }}>
              <span className="k">{hovered.label || hovered.x}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── LineChart ──────────────────────────────────────────────────────────────
export function LineChart({ data, height = 160, color = 'fg', valueFmt = fmt.k, extraRows, yMax, yMin, fill = false }) {
  const [hoverIdx, setHoverIdx] = useStateT(null);
  const [mouse, setMouse] = useStateT({ x: 0, y: 0 });
  const wrapRef = useRefT(null);
  const { w: measuredW, h: measuredH } = useContainerSize(wrapRef);

  const max = yMax ?? Math.max(...data.map((d) => d.v), 1);
  const min = yMin ?? Math.min(...data.map((d) => d.v), 0);
  const top = yMax != null ? max : max * 1.06;
  const step = niceStep((top - min) / 4);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= top; v += step) ticks.push(v);
  if (ticks.length < 2) ticks.push(top);
  const bot = ticks[0];
  const range = top - bot || 1;

  // Native-pixel viewBox so curves & axis text stay crisp on resize.
  // In `fill` mode we also adopt the container height so the SVG no longer
  // needs preserveAspectRatio="none" to stretch — the viewBox already matches.
  const W = Math.max(320, Math.round(measuredW || 1000));
  const H = fill && measuredH ? Math.max(80, Math.round(measuredH)) : height;
  const PAD_L = 56, PAD_R = 8, PAD_T = 6, PAD_B = 22;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const pts = data.map((d, i) => {
    const x = PAD_L + (i / (data.length - 1 || 1)) * plotW;
    const y = PAD_T + plotH - ((d.v - bot) / range) * plotH;
    return [x, y];
  });

  let path = pts.length > 0 ? `M ${pts[0][0]},${pts[0][1]}` : '';
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    const cx = (x1 + x2) / 2;
    path += ` C ${cx},${y1} ${cx},${y2} ${x2},${y2}`;
  }
  const areaPath = pts.length > 0
    ? path + ` L ${pts[pts.length-1][0]},${PAD_T + plotH} L ${pts[0][0]},${PAD_T + plotH} Z`
    : '';

  function handleMouseMove(e) {
    if (!data.length) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMouse({ x: e.clientX, y: e.clientY });
    const relX = (e.clientX - rect.left) / rect.width;
    const svgX = relX * W;
    const idx = Math.round((svgX - PAD_L) / plotW * (data.length - 1));
    setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
  }

  const hd = hoverIdx !== null ? data[hoverIdx] : null;
  const hp = hoverIdx !== null ? pts[hoverIdx] : null;
  const extras = hd && extraRows ? extraRows(hd) : [];

  const MIN_TICK_GAP = 28;
  const ticksWithLabels = (() => {
    let lastY = null;
    return ticks.map(t => {
      const y = PAD_T + plotH - ((t - bot) / range) * plotH;
      const show = lastY === null || Math.abs(y - lastY) >= MIN_TICK_GAP;
      if (show) lastY = y;
      return { t, y, show };
    });
  })();

  return (
    <div
      ref={wrapRef}
      className={`tm-svg-wrap${fill ? ' fill' : ''}`}
      style={{ position: 'relative', cursor: 'crosshair' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={fill ? 'none' : undefined} style={{ fontFamily: 'var(--t-font)', fontWeight: 400 }}>
        {ticksWithLabels.map(({ t, y, show }, i) => (
          <g key={i}>
            <line className="tm-svg-grid" x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} />
            {show && <text className="tm-svg-axis" x={PAD_L - 4} y={y + 3} textAnchor="end">{valueFmt(t)}</text>}
          </g>
        ))}
        <path d={areaPath} fill={`var(--t-${color})`} opacity="0.08" />
        <path d={path} fill="none" stroke={`var(--t-${color})`} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => i % Math.ceil(data.length / 9) === 0 ? (
          <text key={i} className="tm-svg-axis" x={PAD_L + (i / (data.length - 1 || 1)) * plotW} y={H - 6} textAnchor="middle">{d.x ?? d.t}</text>
        ) : null)}
        {hp && (
          <g>
            <line x1={hp[0]} x2={hp[0]} y1={PAD_T} y2={PAD_T + plotH} stroke={`var(--t-${color})`} strokeWidth="0.8" opacity="0.5" strokeDasharray="4 3" />
            <circle cx={hp[0]} cy={hp[1]} r="4" fill={`var(--t-${color})`} opacity="0.9" />
          </g>
        )}
      </svg>
      {hd && hp && (
        <ChartTooltip
          mouse={mouse}
          title={hd.x ?? hd.t}
          rows={[
            { k: 'value', v: valueFmt(hd.v) },
            ...extras.map(r => ({ k: r.k, v: r.v })),
          ]}
        />
      )}
    </div>
  );
}

// ── Toasts ─────────────────────────────────────────────────────────────────
// items: newest-first array (liveTicker). Each unique _ts is shown exactly once.
// Events present on mount are marked seen immediately — no toasts for history.
export function Toasts({ items, ttl = 8000 }) {
  const [stack, setStack] = useStateT([]);
  const seenRef  = useRefT(null);
  const mountRef = useRefT(false);

  useEffectT(() => {
    if (!mountRef.current) {
      // First run: seed the seen-set with everything already in the list.
      mountRef.current = true;
      seenRef.current  = new Set((items || []).map((i) => String(i._ts ?? '')).filter(Boolean));
      return;
    }
    if (!items || !items.length) return;
    const latest = items[0];
    const key = String(latest._ts ?? '');
    if (!key || seenRef.current.has(key)) return;
    seenRef.current.add(key);
    const id = `${key}-${Math.random().toString(36).slice(2, 5)}`;
    setStack((s) => [{ ...latest, id }, ...s].slice(0, 30));
    const t1 = setTimeout(() => setStack((s) => s.map((x) => x.id === id ? { ...x, out: true } : x)), ttl);
    const t2 = setTimeout(() => setStack((s) => s.filter((x) => x.id !== id)), ttl + 380);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [items]);

  return (
    <div className="tm-toasts">
      {stack.map((t) => (
        <div key={t.id} className={`tm-toast ${(t.kind || 'op').toLowerCase()}${t.out ? ' is-out' : ''}`}>
          <span className="kind">{t.label || t.kind}</span>
          <span className="amt">{t.amount} <em>{t.token}</em></span>
          <span className="addr">{t.addr}</span>
        </div>
      ))}
    </div>
  );
}

// ── GridCell ───────────────────────────────────────────────────────────────
export function GridCell({ id, span = 6, height, onResize, children }) {
  const cellRef  = useRefT(null);
  const gripRef  = useRefT(null);
  const dragRef  = useRefT(null);
  const [resizing, setResizing] = useStateT(false);
  const onResizeRef = useRefT(onResize);
  useEffectT(() => { onResizeRef.current = onResize; });

  function onGripPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const parent = cellRef.current?.parentElement;
    if (!parent) return;
    const gap   = parseFloat(getComputedStyle(parent).columnGap) || 14;
    const colPx = (parent.getBoundingClientRect().width - 11 * gap) / 12;
    dragRef.current = { startX: e.clientX, startSpan: span, colPx };
    gripRef.current.setPointerCapture(e.pointerId);
    setResizing(true);
  }
  function onGripPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    const colDelta = Math.round((e.clientX - d.startX) / d.colPx);
    const newSpan  = Math.max(3, Math.min(12, d.startSpan + colDelta));
    onResizeRef.current?.({ span: newSpan });
  }
  function onGripPointerUp() {
    dragRef.current = null;
    setResizing(false);
  }

  const enhanced = Children.map(children, (child) => {
    if (isValidElement(child) && child.type && child.type.name === 'Region') {
      return cloneElement(child, { height });
    }
    return child;
  });

  return (
    <div ref={cellRef} className={`tm-cell c-${span} ${resizing ? 'is-resizing' : ''}`} data-cell-id={id}>
      {enhanced}
      <span ref={gripRef} className="tm-cell-grip"
        onPointerDown={onGripPointerDown}
        onPointerMove={onGripPointerMove}
        onPointerUp={onGripPointerUp}
      >⋰</span>
    </div>
  );
}

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
