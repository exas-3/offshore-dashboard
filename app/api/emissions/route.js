export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { computeEmissions } from '../../../lib/index.js';

let _cache = null, _cacheTs = 0;
const TTL = 3 * 60_000;

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache);
    }
    const data = await computeEmissions();
    _cache = data; _cacheTs = Date.now();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
