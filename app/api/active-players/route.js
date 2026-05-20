// List of every address that has farmed at least 1 wei from a game op
// (DRUG_DEAL / ARMS_DEAL / EXTORTION / PARTIAL / FAIL). Used by the search
// suggestion dropdown to filter out funder / non-player wallets.
//
// ~2,200 addresses today → ~100 KB compressed. Cached aggressively since
// the set only grows.
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db/connection.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
let _cache = null, _cacheTs = 0;
const TTL = 5 * 60_000; // 5 min

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache, { headers: CORS });
    }
    const rows = await getDb()`
      SELECT DISTINCT to_addr AS addr
      FROM transfers
      WHERE kind = 'MINT'
        AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL')
        AND amount > 0
        AND to_addr != '0x0000000000000000000000000000000000000000'`;
    _cache   = { addresses: rows.map(r => r.addr) };
    _cacheTs = Date.now();
    return NextResponse.json(_cache, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
