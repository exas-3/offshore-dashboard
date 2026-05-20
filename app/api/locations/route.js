export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db/connection.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
let _cache = null, _cacheTs = 0;
const TTL = 60 * 60_000; // 1h — locations are effectively static

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache, { headers: CORS });
    }
    const db = getDb();
    const rows = await db`SELECT id, flag_emoji, country, city, short_name, region FROM game_locations ORDER BY id`;
    _cache = { locations: rows };
    _cacheTs = Date.now();
    return NextResponse.json(_cache, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
