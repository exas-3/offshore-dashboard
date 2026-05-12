export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import {
  getPlayerStats, getPlayerActivity, getPlayerVaultPayouts,
  getPlayerOpsBreakdown, getPlayerDailyHistory, getPlayerInfluenceStats,
} from '../../../../lib/index.js';

export async function GET(_req, { params }) {
  try {
    const address = params.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/i.test(address)) {
      return NextResponse.json({ error: 'invalid address' }, { status: 400 });
    }
    const [stats, activity, vault, breakdown, history, influence] = await Promise.all([
      getPlayerStats(address), getPlayerActivity(address, 200, 0),
      getPlayerVaultPayouts(address, 50), getPlayerOpsBreakdown(address),
      getPlayerDailyHistory(address), getPlayerInfluenceStats(address),
    ]);
    return NextResponse.json({ address, stats, activity, vault, breakdown, history, influence });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
