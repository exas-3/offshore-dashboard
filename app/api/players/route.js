export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getPlayerLeaderboard, getPlayerCount } from '../../../lib/index.js';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '200', 10), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0',   10), 0);
    const [rows, total] = await Promise.all([getPlayerLeaderboard(limit, offset), getPlayerCount()]);
    return NextResponse.json({ players: rows, total, limit, offset });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
