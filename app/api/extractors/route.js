export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getTopExtractors } from '../../../lib/index.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
// Heavy aggregate query → cache for 60s so the table can poll without
// hammering the DB.
let _cache = null, _cacheTs = 0;
const TTL = 60_000;

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(500, Number(url.searchParams.get('limit')) || 100);
    if (_cache && _cache.key === limit && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache.data, { headers: CORS });
    }
    const rows = await getTopExtractors(limit);
    const data = { rows: rows.map(r => ({
      address:    r.address,
      alias:      r.alias || null,
      earned:     Number(r.earned     || 0),
      spent:      Number(r.spent      || 0),
      dex_sold:   Number(r.dex_sold   || 0),
      dex_bought: Number(r.dex_bought || 0),
      net_p2p:    Number(r.net_p2p    || 0),
      score:      Number(r.score      || 0),
    })) };
    _cache   = { key: limit, data };
    _cacheTs = Date.now();
    return NextResponse.json(data, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
