export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getTopExtractors } from '../../../lib/index.js';
import { resolveAsOf, bucketAt, DEMO_CACHE_HEADERS } from '../../../lib/demo-clock.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
// Heavy aggregate query → cache for 60s so the table can poll without
// hammering the DB. Demo entries are keyed on the minute-bucketed asOf.
const _cache = new Map();
const TTL = 60_000;
const CACHE_MAX = 32;

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(500, Number(url.searchParams.get('limit')) || 100);
    const asOf = resolveAsOf(req);
    const demo = asOf != null;
    const headers = demo ? { ...CORS, ...DEMO_CACHE_HEADERS } : CORS;
    const key = `${limit}:${demo ? bucketAt(asOf, 300) : 'live'}`;
    const hit = _cache.get(key);
    if (hit && (demo || Date.now() - hit.ts < TTL)) {
      return NextResponse.json(hit.data, { headers });
    }
    const rows = await getTopExtractors(limit, asOf);
    const data = { rows: rows.map(r => ({
      address:    r.address,
      alias:      r.alias || null,
      label:      r.label || null,
      earned:     Number(r.earned     || 0),
      spent:      Number(r.spent      || 0),
      dex_sold:   Number(r.dex_sold   || 0),
      dex_bought: Number(r.dex_bought || 0),
      net_p2p:    Number(r.net_p2p    || 0),
      score:      Number(r.score      || 0),
    })) };
    _cache.set(key, { data, ts: Date.now() });
    while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
    return NextResponse.json(data, { headers });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
