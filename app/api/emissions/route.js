export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { computeEmissions } from '../../../lib/index.js';
import { resolveAsOf, bucketAt } from '../../../lib/demo-clock.js';

const _cache = new Map();
const TTL = 3 * 60_000;
const CACHE_MAX = 8;

export async function GET(request) {
  try {
    const asOf = resolveAsOf(request);
    const demo = asOf != null;
    const key  = demo ? String(bucketAt(asOf, 300)) : 'live';
    const hit = _cache.get(key);
    if (hit && (demo || Date.now() - hit.ts < TTL)) {
      return NextResponse.json(hit.data);
    }
    const data = await computeEmissions(asOf);
    _cache.set(key, { data, ts: Date.now() });
    while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
