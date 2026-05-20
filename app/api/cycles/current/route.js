export const runtime = 'nodejs';
import { NextResponse } from 'next/server';

const SRC = 'https://api.offshoreprotocol.fun/api/cycles/current';
const TTL = 5_000;
let _cache = null, _cacheTs = 0;

const CORS = { 'Access-Control-Allow-Origin': '*' };

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache, { headers: CORS });
    }
    const res = await fetch(SRC, { cache: 'no-store' });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    _cache   = data;
    _cacheTs = Date.now();
    return NextResponse.json(data, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502, headers: CORS });
  }
}
