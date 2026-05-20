export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db/connection.js';

const SLOT_NAMES = {
  1: 'Business',
  2: 'Insurance',
  3: 'Accountant',
  4: 'Method',
  5: 'Associates',
  6: 'OpSec',
};

const CORS = { 'Access-Control-Allow-Origin': '*' };
// Static reference data — long cache is fine.
let _cache = null, _cacheTs = 0;
const TTL = 5 * 60_000;

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache, { headers: CORS });
    }
    const db = getDb();
    const rows = await db`
      SELECT g.id, g.item_name, g.item_type_id, g.specific_location AS city, g.region,
             g.latitude, g.longitude
      FROM game_items g
      ORDER BY g.item_type_id, g.id`;
    const items = rows.map(r => ({
      id:           r.id,
      item_name:    r.item_name,
      item_type_id: r.item_type_id,
      slot:         SLOT_NAMES[r.item_type_id] || `type${r.item_type_id}`,
      city:         r.city,
      region:       r.region,
      latitude:     r.latitude,
      longitude:    r.longitude,
    }));
    _cache   = { items };
    _cacheTs = Date.now();
    return NextResponse.json(_cache, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
