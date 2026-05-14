export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getEnhancedLeaderboard, getPlayerCount } from '../../../lib/index.js';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '1000', 10), 5000);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0',    10), 0);
    const [players, total] = await Promise.all([
      getEnhancedLeaderboard(limit, offset),
      getPlayerCount(),
    ]);
    return NextResponse.json({ players, total, limit, offset });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
