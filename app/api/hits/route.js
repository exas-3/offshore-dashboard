export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getHitsDashboard } from '../../../lib/index.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
let _cache = null, _cacheTs = 0;
const TTL = 3_000;

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit       = Math.min(200, Number(url.searchParams.get('limit'))       || 100);
    const hoursWindow = Math.min(168, Number(url.searchParams.get('hoursWindow')) || 24);
    const key = `${limit}:${hoursWindow}`;
    if (_cache && _cache.key === key && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache.data, { headers: CORS });
    }
    const data = await getHitsDashboard({ limit, hoursWindow });
    _cache   = { key, data };
    _cacheTs = Date.now();
    return NextResponse.json(data, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
