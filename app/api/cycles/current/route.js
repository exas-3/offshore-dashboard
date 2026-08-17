export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { resolveAsOf } from '../../../../lib/demo-clock.js';
import { getCycleStart, SEASON2_START, isWeekendTs } from '../../offshore-data/helpers.js';

const SRC = 'https://api.offshoreprotocol.fun/api/cycles/current';
const TTL = 5_000;
let _cache = null, _cacheTs = 0;

const CORS = { 'Access-Control-Allow-Origin': '*' };

export async function GET(request) {
  try {
    const asOf = resolveAsOf(request);
    if (asOf != null) {
      // Demo: computed locally from the recorded clock — no external upstream.
      const start = getCycleStart(asOf);
      const dur = asOf >= SEASON2_START ? 86400 : (isWeekendTs(asOf) ? 86400 : 28800);
      const elapsed = asOf - start;
      const totalTicks = Math.floor(dur / 96);
      return NextResponse.json({
        demo: true,
        cycle: {
          cycleId: null, // ordinal comes from the payload's currentCycleId
          currentTick: Math.min(totalTicks, Math.floor(elapsed / 96)),
          totalTicks,
          timeRemaining: Math.max(0, start + dur - asOf),
        },
      }, { headers: CORS });
    }
    if (_cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache, { headers: CORS });
    }
    const res = await fetch(SRC, { cache: 'no-store' });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    _cache   = data;
    _cacheTs = Date.now();
    return NextResponse.json(data, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 502, headers: CORS });
  }
}
