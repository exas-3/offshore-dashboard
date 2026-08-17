'use client';
import { useEffect, useMemo, useState } from 'react';

// Picks the right OHLC bucket for the current chart span and polls
// /api/eth-candles?bucket=... at a cadence matching the bucket size.
// Returns { candles, bucketName, bucketSec }.
//
// The server cache (lib/eth-candles.js) already keeps:
//   5s candles for the last 30 min
//   15s candles for the last 1 h
//   1m candles for the last 2 h
// so we just pick whichever bucket comfortably covers the visible span.

const BUCKET_SEC = Object.freeze({ '5s': 5, '15s': 15, '1m': 60 });

function pickBucket(span) {
  if (span <= 15 * 60) return '5s';
  if (span <= 60 * 60) return '15s';
  return '1m';
}

export function useEthCandles({ span, xMin, xMax, tick, enabled = true }) {
  const bucketName = useMemo(() => pickBucket(span), [span]);
  const bucketSec  = BUCKET_SEC[bucketName];

  const [serverCandles, setServerCandles] = useState([]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const interval = bucketSec * 1000;
    const load = () => fetch(`/api/eth-candles?bucket=${bucketName}`, { cache: 'no-cache' })
      .then(r => r.json())
      .then(d => { if (live && Array.isArray(d.candles)) setServerCandles(d.candles); })
      .catch(() => {});
    load();
    const t = setInterval(load, Math.min(5000, interval));
    return () => { live = false; clearInterval(t); };
  }, [bucketName, bucketSec, enabled]);

  // Visible candles. tick is read so the in-progress last candle visually
  // advances each second between server fetches.
  const candles = useMemo(() => {
    void tick;
    return serverCandles.filter(c => c.ts >= xMin - bucketSec && c.ts <= xMax);
  }, [serverCandles, xMin, xMax, bucketSec, tick]);

  return { candles, bucketName, bucketSec };
}
