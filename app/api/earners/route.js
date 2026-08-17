export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getTopEarners } from '../../../lib/index.js';
import { resolveAsOf, bucketAt } from '../../../lib/demo-clock.js';

const _cache = new Map();
const TTL = 120_000;
const CACHE_MAX = 32;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 100);
    const asOf = resolveAsOf(req);
    const demo = asOf != null;
    const key = `${limit}:${demo ? bucketAt(asOf, 300) : 'live'}`;
    const hit = _cache.get(key);
    if (hit && (demo || Date.now() - hit.ts < TTL)) return NextResponse.json({ earners: hit.data });
    const rows = await getTopEarners(limit, asOf);
    const earners = rows.map(r => ({ addr: r.address, total: Number(r.earned), ops: Number(r.ops) }));
    _cache.set(key, { data: earners, ts: Date.now() });
    while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
    return NextResponse.json({ earners });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
