export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import {
  getStats, getLatestTokenInfo, getLatestEthPrice,
  getOpBreakdown, getTotalTransferCount, computeTrueHolderCount,
} from '../../../lib/index.js';
import { fetchVaultBalance, fetchDirtyPrice, fetchLatestInfCost } from '../../../server/etherscan.js';
import { getPricesAt } from '../../../lib/db/token.js';
import { resolveAsOf, nowCap } from '../../../lib/demo-clock.js';
import { getCycleStart, SEASON2_START, isWeekendTs } from '../offshore-data/helpers.js';

// Cycle progress via the canonical Season-aware helper (the old local copy
// here predated the Season 2 cutover and returned 8h weekday cycles forever).
function vaultCycle(nowSec) {
  const now = nowSec ?? Date.now() / 1000;
  const weekend = isWeekendTs(now);
  const DUR = now >= SEASON2_START ? 86400 : (weekend ? 86400 : 28800);
  const start  = getCycleStart(now);
  const elapsed   = now - start;
  const remaining = DUR - elapsed;
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = Math.floor(remaining % 60);
  return {
    progress: elapsed / DUR,
    pct: Math.round((elapsed / DUR) * 100),
    remaining,
    timeStr: `${h}h ${String(m).padStart(2,'0')}m ${String(s).padStart(2,'0')}s`,
    isWeekend: weekend,
    duration: DUR,
  };
}

// Simple module-level cache
let _cache = null, _cacheTs = 0;
const TTL = 30_000;

export async function GET(request) {
  try {
    const asOf = resolveAsOf(request);
    const demo = asOf != null;
    const { now } = nowCap(asOf);
    if (!demo && _cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache);
    }
    const [stats, tokenInfo, ethPrice, opBreakdown, totalTxs, dirtyPrice, infCost, pricesAt] = await Promise.all([
      getStats(asOf), getLatestTokenInfo(asOf), getLatestEthPrice(asOf),
      getOpBreakdown(asOf), getTotalTransferCount(asOf),
      demo ? Promise.resolve(null) : fetchDirtyPrice().catch(() => null),
      demo ? Promise.resolve(null) : fetchLatestInfCost().catch(() => null),
      demo ? getPricesAt(asOf).catch(() => ({ dirty: null, infCost: null })) : Promise.resolve(null),
    ]);
    const result = {
      ...stats,
      supply:      tokenInfo.supply,
      holders:     tokenInfo.holders,
      ethPrice,
      dirtyPrice:  demo ? pricesAt.dirty : dirtyPrice,
      infCost:     demo ? pricesAt.infCost : infCost,
      opBreakdown,
      totalTxs,
      cycle: vaultCycle(now),
    };
    if (demo) return NextResponse.json(result);
    _cache = result; _cacheTs = Date.now();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
