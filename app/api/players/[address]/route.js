export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import {
  getPlayerStats, getPlayerActivity, getPlayerVaultPayouts,
  getPlayerOpsBreakdown, getPlayerDailyHistory, getPlayerInfluenceStats,
  getPlayerRecentMissionStats,
} from '../../../../lib/index.js';
import { getCycleStart } from '../../offshore-data/helpers.js';

export async function GET(_req, { params }) {
  try {
    const address = params.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/i.test(address)) {
      return NextResponse.json({ error: 'invalid address' }, { status: 400 });
    }
    const cycleStart = getCycleStart(Math.floor(Date.now() / 1000));
    const [stats, activity, vault, breakdown, history, influence, recentMissions] = await Promise.all([
      getPlayerStats(address, cycleStart), getPlayerActivity(address, 10000, 0),
      getPlayerVaultPayouts(address, 50), getPlayerOpsBreakdown(address),
      getPlayerDailyHistory(address), getPlayerInfluenceStats(address),
      getPlayerRecentMissionStats(address),
    ]);
    return NextResponse.json({ address, stats, activity, vault, breakdown, history, influence, recentMissions });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
