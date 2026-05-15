export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db.js';

let _cache = null, _cacheTs = 0;
const TTL = 10_000;

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache);
    }

    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    const rows = await db`
      SELECT
        op_type,
        COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 60})   AS m1,
        COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 300})  AS m5,
        COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 900})  AS m15,
        COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 1800}) AS m30,
        COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 3600}) AS m60
      FROM transfers
      WHERE kind = 'MINT'
        AND op_type IN ('DRUG_DEAL', 'ARMS_DEAL', 'EXTORTION')
        AND timestamp::bigint >= ${now - 3600}
      GROUP BY op_type
    `;

    const result = { drugs: {}, arms: {}, extortion: {} };
    const keyMap = { DRUG_DEAL: 'drugs', ARMS_DEAL: 'arms', EXTORTION: 'extortion' };
    const windows = ['m1', 'm5', 'm15', 'm30', 'm60'];

    for (const row of rows) {
      const key = keyMap[row.op_type];
      if (!key) continue;
      result[key] = {};
      for (const w of windows) result[key][w] = Number(row[w] ?? 0);
    }
    for (const key of ['drugs', 'arms', 'extortion']) {
      if (!result[key].m1) result[key] = { m1: 0, m5: 0, m15: 0, m30: 0, m60: 0 };
    }

    _cache = result;
    _cacheTs = Date.now();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ drugs: {}, arms: {}, extortion: {} }, { status: 500 });
  }
}
