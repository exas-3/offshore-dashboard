export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/index.js';

let _cache = null, _cacheTs = 0;
const TTL = 10_000;

const WINDOWS = ['m1', 'm5', 'm15', 'm30', 'm60'];
const EMPTY_WIN = () => Object.fromEntries(WINDOWS.map(w => [w, { ok: 0, bust: 0 }]));

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache);
    }

    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    // ok:   amount IN (100, 115, 130) — the only valid completion payouts
    // bust: any other amount (extortion busts give 5 DIRTY; PARTIAL = busted arms/drugs)
    const rows = await db`
      SELECT
        op_type,
        (amount IN (100, 115, 130)) AS is_ok,
        COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 60})   AS m1,
        COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 300})  AS m5,
        COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 900})  AS m15,
        COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 1800}) AS m30,
        COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 3600}) AS m60
      FROM transfers
      WHERE kind = 'MINT'
        AND op_type IN ('DRUG_DEAL', 'ARMS_DEAL', 'EXTORTION', 'PARTIAL')
        AND timestamp::bigint >= ${now - 3600}
      GROUP BY op_type, is_ok
    `;

    const result = { drugs: EMPTY_WIN(), arms: EMPTY_WIN(), extortion: EMPTY_WIN() };
    const keyMap = { DRUG_DEAL: 'drugs', ARMS_DEAL: 'arms', EXTORTION: 'extortion', PARTIAL: null };

    for (const row of rows) {
      const key = keyMap[row.op_type];
      const field = row.is_ok ? 'ok' : 'bust';
      if (key) {
        for (const w of WINDOWS) result[key][w][field] += Number(row[w] ?? 0);
      }
    }

    _cache = result;
    _cacheTs = Date.now();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ drugs: {}, arms: {}, extortion: {} }, { status: 500 });
  }
}
