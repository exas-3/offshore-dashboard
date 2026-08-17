'use client';
import { useEffect, useMemo, useState } from 'react';
import { bucketAt } from '../../../lib/demo-constants.js';

// Historical ETH oracle tape for the criminal-watch chart in demo mode.
// eth_price_snapshots is backfilled at 60s from the RedStone adapter the
// dashboard always used (scripts/backfill-eth-oracle.mjs), so these are the
// exact prices the oracle reported at each recorded minute.
export function useEthHistory({ now, xMin, enabled = true }) {
  const at = bucketAt(now, 60);
  const hours = useMemo(() => {
    const need = (at - xMin) / 3600 + 0.5;
    return Math.min(7, Math.max(1, Math.ceil(need)));
  }, [at, xMin]);

  const [points, setPoints] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`/api/eth-price-history?hours=${hours}&at=${at}`)
      .then(r => r.json())
      .then(d => {
        if (live && Array.isArray(d?.history)) {
          setPoints(d.history.map(r => ({ ts: Number(r.timestamp), price: Number(r.price_usd) })));
        }
      })
      .catch(() => {});
    return () => { live = false; };
  }, [at, hours, enabled]);

  const visible = useMemo(
    () => points.filter(p => p.ts >= xMin - 60 && p.ts <= now && p.price > 0),
    [points, xMin, now]
  );
  return { points: visible, bucketSec: 60 };
}
