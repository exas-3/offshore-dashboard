export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getWalletAliases } from '../../../lib/index.js';

let _cache = null, _cacheTs = 0;
const TTL = 60_000;

export async function GET() {
  try {
    if (!_cache || Date.now() - _cacheTs >= TTL) {
      _cache = await getWalletAliases();
      _cacheTs = Date.now();
    }
    return NextResponse.json(_cache);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
