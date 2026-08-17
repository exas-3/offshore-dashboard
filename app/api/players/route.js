export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getEnhancedLeaderboard, getPlayerCount } from '../../../lib/index.js';
import { resolveAsOf } from '../../../lib/demo-clock.js';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '1000', 10), 5000);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0',    10), 0);
    const asOf = resolveAsOf(req);
    const [players, total] = await Promise.all([
      getEnhancedLeaderboard(limit, offset, asOf),
      getPlayerCount(asOf),
    ]);
    return NextResponse.json({ players, total, limit, offset });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
