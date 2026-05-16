'use client';
import {
  useState,
  useRef,
  useEffect,
  Children,
  isValidElement,
  cloneElement,
} from 'react';

// ── Internal helpers ──────────────────────────────────────────────────────

const THEMES = [
  { id: 'purple', dot: '#a674ff' },
  { id: 'amber',  dot: '#ffb000' },
  { id: 'green',  dot: '#4ade80' },
  { id: 'paper',  dot: '#f7f3e8' },
];

function nowUTC() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

function TweaksPanel({ theme, onThemeChange, notifPrefs, onNotifChange, onClose, btnRef }) {
  const ref = useRef(null);
  useEffect(() => {
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

// ── Shell ─────────────────────────────────────────────────────────────────

export function TerminalShell({ apps, activeAppId, onAppChange, ticker, tabs, activeTab, onTabChange, search, onSearch, fkeys, sideFooter, children, rail, clock, theme = 'purple', density = 'regular', mode = 'standalone', nav, brand, sideContent, railLabel = 'criminal', onThemeChange, notifPrefs, onNotifChange, openRailRef }) {
  const [now, setNow] = useState(clock || nowUTC());
  const [activeSection, setActiveSection] = useState(nav && nav[0] ? nav[0].id : null);
  const [railOpen, setRailOpen] = useState(false);
  useEffect(() => { if (openRailRef) openRailRef.current = () => setRailOpen(true); }, [openRailRef]);
  const [sideOpen, setSideOpen] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth > 720
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tickerTooltip, setTickerTooltip] = useState(null);
  const settingsBtnRef = useRef(null);
  const [showTweakHint, setShowTweakHint] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !localStorage.getItem('offshore-hint-seen');
  });
  function dismissHint() {
    if (typeof window !== 'undefined') localStorage.setItem('offshore-hint-seen', '1');
    setShowTweakHint(false);
  }
  useEffect(() => {
    if (!showTweakHint) return;
    const t = setTimeout(dismissHint, 8000);
    return () => clearTimeout(t);
  }, [showTweakHint]);
  useEffect(() => {
    if (clock) return;
    const t = setInterval(() => setNow(nowUTC()), 1000);
    return () => clearInterval(t);
  }, [clock]);

  useEffect(() => {
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
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button
                ref={settingsBtnRef}
                onClick={() => { setSettingsOpen(o => !o); if (showTweakHint) dismissHint(); }}
                title="tweaks"
                style={{
                  background: settingsOpen ? 'var(--t-fg)' : 'var(--t-bg-soft)',
                  color: settingsOpen ? 'var(--t-bg)' : 'var(--t-fg)',
                  border: settingsOpen ? '1px solid var(--t-fg)' : `1px solid ${showTweakHint ? 'var(--t-fg)' : 'var(--t-fg-soft)'}`,
                  fontFamily: 'var(--t-font)', fontSize: 11,
                  padding: '0 9px', cursor: 'pointer',
                  letterSpacing: '0.06em', height: 18,
                  display: 'inline-flex', alignItems: 'center',
                  marginLeft: 6,
                }}
              >
                ⚙
              </button>
              {showTweakHint && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 7px)', right: 0,
                  background: 'var(--t-fg)', color: 'var(--t-bg)',
                  fontSize: 10, fontFamily: 'var(--t-font)',
                  padding: '4px 8px', whiteSpace: 'nowrap',
                  zIndex: 300, pointerEvents: 'none',
                  letterSpacing: '0.05em',
                }}>
                  <span style={{
                    position: 'absolute', top: -4, right: 10,
                    width: 0, height: 0,
                    borderLeft: '4px solid transparent',
                    borderRight: '4px solid transparent',
                    borderBottom: '4px solid var(--t-fg)',
                  }} />
                  <span className="tm-blink">↑</span> click to customize theme
                </div>
              )}
            </div>
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
        <span className="right">Developed with <span style={{ color: 'var(--t-heart)' }}>♥</span> by <a href="https://x.com/s_exas" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>@s_exas</a></span>
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

// ── Toasts ─────────────────────────────────────────────────────────────────

export function Toasts({ items, ttl = 8000 }) {
  const [stack, setStack] = useState([]);
  const seenRef  = useRef(null);
  const mountRef = useRef(false);

  useEffect(() => {
    if (!mountRef.current) {
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
  const cellRef  = useRef(null);
  const gripRef  = useRef(null);
  const dragRef  = useRef(null);
  const [resizing, setResizing] = useState(false);
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; });

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
