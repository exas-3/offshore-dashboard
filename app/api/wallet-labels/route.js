// Map of address → behavioral label (extractor / contributor / neutral)
// for every wallet that's been classified. Small enough (~750 rows) to
// fetch once and use as a client-side join across tables (ongoing crimes,
// finished crimes, hits, etc.).
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db/connection.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
let _cache = null, _cacheTs = 0;
const TTL = 60_000; // 1 min — labels are recomputed hourly

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache, { headers: CORS });
    }
    const rows = await getDb()`SELECT address, label FROM wallet_aliases WHERE label IS NOT NULL`;
    const map = Object.fromEntries(rows.map(r => [r.address, r.label]));
    _cache = { labels: map };
    _cacheTs = Date.now();
    return NextResponse.json(_cache, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
