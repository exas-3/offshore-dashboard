export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getHitsDashboard } from '../../../lib/index.js';
import { resolveAsOf, bucketAt, DEMO_CACHE_HEADERS } from '../../../lib/demo-clock.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
const _cache = new Map();
const TTL = 3_000;
const CACHE_MAX = 32;

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const limit       = Math.max(1, Math.floor(Math.min(200, Number(url.searchParams.get('limit'))       || 100)));
    const hoursWindow = Math.max(1, Math.floor(Math.min(168, Number(url.searchParams.get('hoursWindow')) || 24)));
    const asOf = resolveAsOf(req);
    const demo = asOf != null;
    const headers = demo ? { ...CORS, ...DEMO_CACHE_HEADERS } : CORS;
    const key = `${limit}:${hoursWindow}:${demo ? bucketAt(asOf, 60) : 'live'}`;
    const hit = _cache.get(key);
    if (hit && (demo || Date.now() - hit.ts < TTL)) {
      return NextResponse.json(hit.data, { headers });
    }
    const data = await getHitsDashboard({ limit, hoursWindow, asOf });
    _cache.set(key, { data, ts: Date.now() });
    while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
    return NextResponse.json(data, { headers });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
