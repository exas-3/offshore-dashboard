export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { fetchEthPrice } from '../../../server/etherscan.js';
import { getLatestEthPrice } from '../../../lib/index.js';

let _cached = null, _cachedTs = 0;
const TTL = 3_000;

export async function GET() {
  if (_cached && Date.now() - _cachedTs < TTL) {
    return NextResponse.json({ price: _cached });
  }
  try {
    const price = await fetchEthPrice();
    _cached = price;
    _cachedTs = Date.now();
    return NextResponse.json({ price });
  } catch {
    const fallback = await getLatestEthPrice().catch(() => null);
    return NextResponse.json({ price: fallback ?? _cached ?? 0 });
  }
}
