export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db/connection.js';
import { resolveAsOf, nowCap, bucketAt, DEMO_CACHE_HEADERS, DEMO_MODE } from '../../../lib/demo-clock.js';

// DIRTY price tape for the criminal-watch chart in demo/time-travel mode.
// GET /api/dirty-history?at=<unix|ISO>&span=<seconds>
//   → { at, span, points: [{ ts, dirty, infCost }, …] }  (60s cadence)
const CORS = { 'Access-Control-Allow-Origin': '*' };
const SPAN_MIN = 300, SPAN_MAX = 6 * 3600;

export async function GET(req) {
  try {
    const url  = new URL(req.url);
    const asOf = resolveAsOf(req);
    const { now } = nowCap(asOf);
    const at = bucketAt(now, 60);
    const span = Math.min(SPAN_MAX, Math.max(SPAN_MIN, Number(url.searchParams.get('span')) || 7200));

    // Two sources, merged per minute: the poller's 60s price_snapshots tape
    // (has multi-hour gaps, e.g. ~43h around the Season 2 launch) and
    // per-swap prices from v_dex_swaps. Snapshots win when both exist.
    const db = getDb();
    const [snapRows, swapRows] = await Promise.all([
      db`
        SELECT timestamp::bigint AS ts, dirty::float AS dirty, inf_cost::float AS inf_cost
        FROM price_snapshots
        WHERE timestamp >= ${at - span} AND timestamp <= ${at} AND dirty IS NOT NULL
        ORDER BY timestamp ASC`.catch(() => []),
      db`
        SELECT (FLOOR(ts::float / 60) * 60)::bigint AS ts, AVG(price_usdm_per_dirty)::float AS dirty
        FROM v_dex_swaps
        WHERE ts >= ${at - span} AND ts <= ${at} AND price_usdm_per_dirty IS NOT NULL
        GROUP BY 1 ORDER BY 1 ASC`.catch(() => []),
    ]);

    const byMinute = new Map();
    for (const r of swapRows) byMinute.set(Number(r.ts), { ts: Number(r.ts), dirty: Number(r.dirty), infCost: null });
    for (const r of snapRows) {
      const m = Math.floor(Number(r.ts) / 60) * 60;
      byMinute.set(m, { ts: m, dirty: Number(r.dirty), infCost: r.inf_cost != null ? Number(r.inf_cost) : null });
    }
    const points = [...byMinute.values()].sort((a, b) => a.ts - b.ts);

    const headers = (asOf != null || DEMO_MODE) ? { ...CORS, ...DEMO_CACHE_HEADERS } : CORS;
    return NextResponse.json({ at, span, points }, { headers });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
