'use client';
import { useState, useEffect } from 'react';
import { OffshoreDashboard } from './offshore.jsx';
import { VirtualClockProvider } from './hooks/use-virtual-clock.js';
import { DEMO, DEMO_DEFAULT_AT, clampAt, bucketAt } from '../../lib/demo-constants.js';

// ?at=<unix|ISO> and ?speed=<1|60|3600> deep links (demo mode only).
function parseUrlAt() {
  if (!DEMO) return { at: null, speed: 0 }; // live: clock anchors to real now
  if (typeof window === 'undefined') return { at: DEMO_DEFAULT_AT, speed: 0 };
  try {
    const sp = new URL(window.location.href).searchParams;
    const raw = sp.get('at');
    let at = DEMO_DEFAULT_AT;
    if (raw) {
      const n = /^\d{9,12}$/.test(raw) ? Number(raw) : Math.floor(Date.parse(raw) / 1000);
      if (Number.isFinite(n)) at = clampAt(n);
    }
    const spd = Number(sp.get('speed'));
    return { at, speed: [1, 60, 3600].includes(spd) ? spd : 0 };
  } catch { return { at: DEMO_DEFAULT_AT, speed: 0 }; }
}

const THEME_FAVICON = {
  amber:  { fg: '#ffb000', bg: '#000000' },
  purple: { fg: '#a674ff', bg: '#050009' },
  green:  { fg: '#4ade80', bg: '#020603' },
  paper:  { fg: '#6b4400', bg: '#f7f3e8' },
};

function setFavicon(theme) {
  const { fg, bg } = THEME_FAVICON[theme] || THEME_FAVICON.purple;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><circle cx="32" cy="32" r="24" fill="none" stroke="${fg}" stroke-width="2.5"/><line x1="8" y1="32" x2="56" y2="32" stroke="${fg}" stroke-width="2.5"/><ellipse cx="32" cy="32" rx="9" ry="24" fill="none" stroke="${fg}" stroke-width="2.5"/><circle cx="44" cy="22" r="5" fill="${fg}"/></svg>`;
  const url = 'data:image/svg+xml,' + encodeURIComponent(svg);
  document.querySelectorAll("link[rel~='icon']").forEach(el => el.parentNode.removeChild(el));
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = url;
  document.head.appendChild(link);
}

export default function PageClient({ initialAddress = '' } = {}) {
  const [data, setData] = useState(null);
  const [slowLoad, setSlowLoad] = useState(false);
  const [theme, setTheme] = useState('amber');
  const [initialClock] = useState(parseUrlAt);

  useEffect(() => {
    const saved = typeof window !== 'undefined' && localStorage.getItem('offshore-theme');
    if (saved && saved !== theme) setTheme(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setFavicon(theme); }, [theme]);

  useEffect(() => {
    if (data) return;
    const t = setTimeout(() => setSlowLoad(true), 1000);
    return () => clearTimeout(t);
  }, [data]);

  function handleThemeChange(t) {
    setTheme(t);
    localStorage.setItem('offshore-theme', t);
    setFavicon(t);
  }

  useEffect(() => {
    const url = DEMO
      ? `/api/offshore-data?at=${bucketAt(initialClock.at, 60)}`
      : '/api/offshore-data';
    const load = () =>
      fetch(url, DEMO ? undefined : { cache: 'no-cache' })
        .then(r => r.json())
        .then(setData)
        .catch(console.error);
    load();
    if (DEMO) return; // OffshoreDashboard owns refreshes in demo mode
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) {
    const { fg, bg } = THEME_FAVICON[theme] || THEME_FAVICON.paper;
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
    const hardRefresh = isMac ? '⌘ + Shift + R' : 'Ctrl + Shift + R';
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12,
        height: '100vh', background: bg, color: fg,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 13,
        letterSpacing: '0.04em',
      }}>
        <span style={{ opacity: 0.7 }}>loading offshore data…</span>
        {slowLoad && (
          <span style={{ opacity: 0.55, fontSize: 11 }}>
            try a hard refresh: <b style={{ opacity: 0.9 }}>{hardRefresh}</b>
          </span>
        )}
      </div>
    );
  }

  return (
    <VirtualClockProvider initialAt={initialClock.at} initialSpeed={initialClock.speed}>
      <OffshoreDashboard D={data} theme={theme} onThemeChange={handleThemeChange} initialAddress={initialAddress} />
    </VirtualClockProvider>
  );
}
