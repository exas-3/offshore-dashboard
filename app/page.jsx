'use client';
import { useState, useEffect } from 'react';
import { OffshoreDashboard } from './_components/offshore.jsx';

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
  // Remove all existing icon links so the browser is forced to adopt the new one
  document.querySelectorAll("link[rel~='icon']").forEach(el => el.parentNode.removeChild(el));
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = url;
  document.head.appendChild(link);
}

export default function Page({ initialAddress = '' } = {}) {
  const [data, setData] = useState(null);
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('offshore-theme') || 'amber';
    }
    return 'amber';
  });

  useEffect(() => { setFavicon(theme); }, [theme]);

  function handleThemeChange(t) {
    setTheme(t);
    localStorage.setItem('offshore-theme', t);
    setFavicon(t);
  }

  useEffect(() => {
    const load = () =>
      fetch('/api/offshore-data', { cache: 'no-cache' })
        .then(r => r.json())
        .then(setData)
        .catch(console.error);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!data) {
    const { fg, bg } = THEME_FAVICON[theme] || THEME_FAVICON.paper;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: bg, color: fg,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 13,
        letterSpacing: '0.04em',
      }}>
        <span style={{ opacity: 0.7 }}>loading offshore data…</span>
      </div>
    );
  }

  return <OffshoreDashboard D={data} theme={theme} onThemeChange={handleThemeChange} initialAddress={initialAddress} />;
}
