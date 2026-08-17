export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import {
  getPlayerStats, getPlayerActivity, getPlayerVaultPayouts,
  getPlayerOpsBreakdown, getPlayerDailyHistory, getPlayerInfluenceStats,
  getPlayerRecentMissionStats, getWalletLabel,
} from '../../../../lib/index.js';
import { getCycleStart } from '../../offshore-data/helpers.js';
import { resolveAsOf, nowCap } from '../../../../lib/demo-clock.js';

export async function GET(req, { params }) {
  try {
    const address = params.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/i.test(address)) {
      return NextResponse.json({ error: 'invalid address' }, { status: 400 });
    }
    const asOf = resolveAsOf(req);
    const { now } = nowCap(asOf);
    const cycleStart = getCycleStart(now);
    const [stats, activity, vault, breakdown, history, influence, recentMissions, labelRow] = await Promise.all([
      getPlayerStats(address, cycleStart, asOf), getPlayerActivity(address, 10000, 0, asOf),
      getPlayerVaultPayouts(address, 50, asOf), getPlayerOpsBreakdown(address, asOf),
      getPlayerDailyHistory(address, asOf), getPlayerInfluenceStats(address, asOf),
      getPlayerRecentMissionStats(address, asOf), getWalletLabel(address),
    ]);
    const label = labelRow ? {
      label:             labelRow.label || null,
      label_score:       labelRow.label_score != null ? Number(labelRow.label_score) : null,
      label_computed_at: labelRow.label_computed_at != null ? Number(labelRow.label_computed_at) : null,
    } : null;
    return NextResponse.json({ address, stats, activity, vault, breakdown, history, influence, recentMissions, label });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
