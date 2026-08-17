export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb, getActiveTradeCountsAt } from '../../../lib/index.js';
import { resolveAsOf, nowCap, bucketAt, DEMO_CACHE_HEADERS } from '../../../lib/demo-clock.js';

const _cache = new Map(); // bucketed-asOf | 'live' → { data, ts }
const TTL = 10_000;
const CACHE_MAX = 32;

const WINDOWS = ['m1', 'm5', 'm15', 'm30', 'm60', 'h24'];
const EMPTY_WIN = () => Object.fromEntries(WINDOWS.map(w => [w, { ok: 0, bust: 0 }]));

export async function GET(request) {
  try {
    const asOf = resolveAsOf(request);
    const demo = asOf != null;
    const key  = demo ? String(bucketAt(asOf, 60)) : 'live';
    const headers = demo ? DEMO_CACHE_HEADERS : {};
    const hit = _cache.get(key);
    if (hit && (demo || Date.now() - hit.ts < TTL)) {
      return NextResponse.json(hit.data, { headers });
    }

    const db = getDb();
    const { now } = nowCap(asOf);

    // ok / bust comes from the structural `result` column populated at sync
    // time: transfers.js (DirtyPaid) → 'completed', liquidations.js
    // (TradeExited) → 'busted'. Season 2 payouts are 50-100 scaled by Power
    // Level and progressive bust refunds can sit anywhere in that range, so
    // amount alone can't distinguish them — only the structural signal does.
    // PARTIAL rows are transient (storage-slot read failed) — treated as
    // busted for matrix purposes since the partial-sweep retry will retag.
    const [rows, activeRows] = await Promise.all([
      db`
        SELECT
          op_type,
          (result = 'completed') AS is_ok,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 60})    AS m1,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 300})   AS m5,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 900})   AS m15,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 1800})  AS m30,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 3600})  AS m60,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 86400}) AS h24
        FROM transfers
        WHERE kind = 'MINT'
          AND op_type IN ('DRUG_DEAL', 'ARMS_DEAL', 'EXTORTION', 'PARTIAL')
          AND timestamp::bigint >= ${now - 86400} AND timestamp::bigint <= ${now}
        GROUP BY op_type, is_ok
      `,
      // currently-active counts come from companies.trade_type (populated by syncCompanies).
      // trade_type is sticky (COALESCE upsert) so we must also require end_time > now —
      // otherwise finished trades show as phantom active entries.
      // Demo: companies is mutable current-state — reconstruct instead.
      demo ? getActiveTradeCountsAt(asOf) : db`
        SELECT trade_type, COUNT(*)::int AS cnt
        FROM companies
        WHERE active = TRUE
          AND trade_type IS NOT NULL
          AND end_time > ${now}
        GROUP BY trade_type
      `,
    ]);

    const result = {
      drugs:     { ...EMPTY_WIN(), active: 0 },
      arms:      { ...EMPTY_WIN(), active: 0 },
      extortion: { ...EMPTY_WIN(), active: 0 },
    };
    const keyMap = { DRUG_DEAL: 'drugs', ARMS_DEAL: 'arms', EXTORTION: 'extortion', PARTIAL: null };

    for (const row of rows) {
      const key = keyMap[row.op_type];
      const field = row.is_ok ? 'ok' : 'bust';
      if (key) {
        for (const w of WINDOWS) result[key][w][field] += Number(row[w] ?? 0);
      }
    }
    for (const row of activeRows) {
      const key = keyMap[row.trade_type];
      if (key) result[key].active = Number(row.cnt ?? 0);
    }

    _cache.set(key, { data: result, ts: Date.now() });
    while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
    return NextResponse.json(result, { headers });
  } catch (e) {
    return NextResponse.json({ drugs: {}, arms: {}, extortion: {} }, { status: 500 });
  }
}
