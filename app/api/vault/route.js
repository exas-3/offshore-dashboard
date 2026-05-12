export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getVaultStats, getVaultCycleHistory, getVaultTopEarners, getVaultRecentPayouts } from '../../../lib/index.js';
import { fetchVaultBalance } from '../../../server/etherscan.js';

let _cache = null, _cacheTs = 0;
const TTL = 15_000;

export async function GET() {
  try {
    if (!_cache || Date.now() - _cacheTs >= TTL) {
      const [stats, cycleHistory, topEarners, recentPayouts] = await Promise.all([
        getVaultStats(), getVaultCycleHistory(), getVaultTopEarners(50), getVaultRecentPayouts(100),
      ]);
      _cache = { stats, cycleHistory, topEarners, recentPayouts };
      _cacheTs = Date.now();
    }
    let currentBalance = null;
    try { currentBalance = await fetchVaultBalance(); } catch { /* non-critical */ }
    return NextResponse.json({ ..._cache, currentBalance });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
