export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getLatestEthPrice } from '../../../lib/db.js';

const RPC    = 'https://mainnet.megaeth.com/rpc';
const ORACLE = '0xc555c100DB24dF36D406243642C169CC5A937f09';
// latestRoundData() selector
const CALLDATA = '0xfeaf968c';

let _cached = null, _cachedTs = 0;
const TTL = 1000;

export async function GET() {
  if (_cached && Date.now() - _cachedTs < TTL) {
    return NextResponse.json({ price: _cached });
  }
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: ORACLE, data: CALLDATA }, 'latest'], id: 1 }),
      cache: 'no-cache',
    });
    if (res.ok) {
      const { result } = await res.json();
      // answer is the 2nd 32-byte word (bytes 32–64), 8 decimals
      const answer = BigInt('0x' + result.slice(66, 130));
      const price = Number(answer) / 1e8;
      if (isFinite(price) && price > 0) {
        _cached = price;
        _cachedTs = Date.now();
        return NextResponse.json({ price });
      }
    }
  } catch {}
  const dbPrice = await getLatestEthPrice().catch(() => null);
  return NextResponse.json({ price: dbPrice ?? _cached ?? 0 });
}
