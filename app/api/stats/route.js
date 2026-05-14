export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import {
  getStats, getLatestTokenInfo, getLatestEthPrice,
  getOpBreakdown, getTotalTransferCount, computeTrueHolderCount,
} from '../../../lib/index.js';
import { fetchVaultBalance, fetchDirtyPrice, fetchLatestInfCost } from '../../../server/etherscan.js';

const WEEKDAY_PHASE  = 5400;
const WEEKEND_ANCHOR = 9 * 3600 + 30 * 60;
const WEEKDAY_DUR    = 8  * 3600;
const WEEKEND_DUR    = 24 * 3600;

function isWeekendCycle(nowSec) {
  const d = new Date(nowSec * 1000);
  const dow = d.getUTCDay();
  const s   = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  if (dow === 6 && s >= WEEKEND_ANCHOR) return true;
  if (dow === 0) return true;
  if (dow === 1 && s < WEEKEND_ANCHOR) return true;
  return false;
}

function vaultCycle() {
  const now = Date.now() / 1000;
  const weekend = isWeekendCycle(now);
  const DUR = weekend ? WEEKEND_DUR : WEEKDAY_DUR;
  const ANCHOR = weekend ? WEEKEND_ANCHOR : WEEKDAY_PHASE;
  const start  = Math.floor((now - ANCHOR) / DUR) * DUR + ANCHOR;
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

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) {
      return NextResponse.json(_cache);
    }
    const [stats, tokenInfo, ethPrice, opBreakdown, totalTxs, dirtyPrice, infCost] = await Promise.all([
      getStats(), getLatestTokenInfo(), getLatestEthPrice(),
      getOpBreakdown(), getTotalTransferCount(),
      fetchDirtyPrice().catch(() => null),
      fetchLatestInfCost().catch(() => null),
    ]);
    const result = {
      ...stats,
      supply:      tokenInfo.supply,
      holders:     tokenInfo.holders,
      ethPrice,
      dirtyPrice,
      infCost,
      opBreakdown,
      totalTxs,
      cycle: vaultCycle(),
    };
    _cache = result; _cacheTs = Date.now();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
