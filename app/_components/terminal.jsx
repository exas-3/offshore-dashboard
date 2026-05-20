'use client';
import { useEffect, useState } from 'react';
export * from './terminal/fmt.js';
export * from './terminal/charts.jsx';
export * from './terminal/ui.jsx';

// One-shot fetch of the 15 game locations (id → flag/city/country). Used by
// useLocations() to share a single cache across every consumer.
let _locationsPromise = null;
let _locationsMap    = null;
function fetchLocationsOnce() {
  if (_locationsMap) return Promise.resolve(_locationsMap);
  if (_locationsPromise) return _locationsPromise;
  _locationsPromise = fetch('/api/locations')
    .then(r => r.json())
    .then(d => {
      const m = new Map();
      for (const l of (d.locations || [])) m.set(Number(l.id), l);
      _locationsMap = m;
      return m;
    })
    .catch(() => new Map());
  return _locationsPromise;
}

export function useLocations() {
  const [map, setMap] = useState(_locationsMap || new Map());
  useEffect(() => {
    if (_locationsMap) return;
    let alive = true;
    fetchLocationsOnce().then(m => { if (alive) setMap(m); });
    return () => { alive = false; };
  }, []);
  return map;
}

// One-shot fetch of wallet → behavior label map. Used to render a behavior
// chip next to addresses in tables (ongoing crimes, etc.). Refreshes on
// page load only — labels are recomputed by an hourly cron server-side.
let _labelsPromise = null;
let _labelsMap    = null;
function fetchLabelsOnce() {
  if (_labelsMap) return Promise.resolve(_labelsMap);
  if (_labelsPromise) return _labelsPromise;
  _labelsPromise = fetch('/api/wallet-labels')
    .then(r => r.json())
    .then(d => { _labelsMap = d?.labels || {}; return _labelsMap; })
    .catch(() => ({}));
  return _labelsPromise;
}

export function useWalletLabels() {
  const [map, setMap] = useState(_labelsMap || {});
  useEffect(() => {
    if (_labelsMap) return;
    let alive = true;
    fetchLabelsOnce().then(m => { if (alive) setMap(m); });
    return () => { alive = false; };
  }, []);
  return map;
}

// Flag pill for a location id. Tooltip shows city/country.
export function Flag({ locationId, locations, size = 'sm' }) {
  if (locationId == null || locationId === undefined) return null;
  const loc = locations?.get?.(Number(locationId));
  if (!loc) return null;
  const fs = size === 'xs' ? 11 : 13;
  return (
    <span
      title={`${loc.city ?? ''}${loc.country ? `, ${loc.country}` : ''}`.trim() || loc.short_name}
      style={{ fontSize: fs, lineHeight: 1, marginRight: 4 }}
    >{loc.flag_emoji || '🏳️'}</span>
  );
}

// Behavioral-classification chip — rendered next to addresses across the
// dashboard. Color-coded: extractor = red, contributor = green, neutral = grey.
// Label values come from wallet_aliases.label (set by `npm run label-wallets`).
export function LabelChip({ label, size = 'sm', title }) {
  if (!label) return null;
  const palette = {
    extractor:   { color: 'var(--t-bg)',     bg: 'var(--t-neg)',     border: 'var(--t-neg)'   },
    contributor: { color: 'var(--t-bg)',     bg: 'var(--t-pos)',     border: 'var(--t-pos)'   },
    neutral:     { color: 'var(--t-fg-mut)', bg: 'transparent',      border: 'var(--t-rule)'  },
  };
  const c = palette[label] || palette.neutral;
  const pad = size === 'xs' ? '0 4px' : '1px 6px';
  const fs  = size === 'xs' ? 9       : 10;
  return (
    <span
      title={title || `behavior: ${label}`}
      style={{
        display: 'inline-block',
        background: c.bg, color: c.color,
        border: `1px solid ${c.border}`,
        padding: pad,
        fontFamily: 'var(--t-font)',
        fontSize: fs,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        lineHeight: 1.3,
        whiteSpace: 'nowrap',
      }}
    >{label}</span>
  );
}
