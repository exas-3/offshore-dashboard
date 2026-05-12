export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getTopEarners } from '../../../lib/index.js';

let _cache = null, _cacheTs = 0;
const TTL = 120_000;

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 100);
    if (_cache && Date.now() - _cacheTs < TTL) return NextResponse.json({ earners: _cache });
    const earners = await getTopEarners(limit);
    _cache = earners; _cacheTs = Date.now();
    return NextResponse.json({ earners });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
