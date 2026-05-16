export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getVaultStats, getVaultCycleHistory, getVaultTopEarners, getVaultRecentPayouts, getVaultFirstPayouts, getTopStakers24h } from '../../../lib/index.js';
import { fetchVaultBalance } from '../../../server/etherscan.js';
import { getCycleStart } from '../offshore-data/helpers.js';

function fmtCycleLabel(ts) {
  const d = new Date(ts * 1000);
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  const hh  = String(d.getUTCHours()).padStart(2, '0');
  const mm  = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mon} ${day} ${hh}:${mm}`;
}

let _cache = null, _cacheTs = 0;
const TTL = 15_000;

export async function GET() {
  try {
    if (!_cache || Date.now() - _cacheTs >= TTL) {
      const [rawStats, rawPayouts, rawEarners, recentPayouts, firstPayouts, rawTopStakers] = await Promise.all([
        getVaultStats(), getVaultCycleHistory(), getVaultTopEarners(50), getVaultRecentPayouts(100), getVaultFirstPayouts(), getTopStakers24h(),
      ]);

      // Group payouts by actual cycle
      const cycleMap = new Map();
      for (const row of rawPayouts) {
        const start = getCycleStart(Number(row.timestamp));
        const entry = cycleMap.get(start);
        if (entry) {
          entry.total    += Number(row.amount);
          entry.payouts  += 1;
        } else {
          cycleMap.set(start, { total: Number(row.amount), payouts: 1 });
        }
      }

      // Count new recipients per cycle (first-ever payout falls in that cycle).
      const newRecipMap = new Map();
      for (const row of firstPayouts) {
        const start = getCycleStart(Number(row.first_ts));
        newRecipMap.set(start, (newRecipMap.get(start) ?? 0) + 1);
      }

      const cycleHistory = [...cycleMap.entries()]
        .sort(([a], [b]) => a - b)
        .slice(-60)
        .map(([start, r]) => ({
          label:          fmtCycleLabel(start),
          distributed:    r.total,
          burned:         0,
          recipients:     r.payouts,
          newRecipients:  newRecipMap.get(start) ?? 0,
        }));

      const stats = {
        distributed:      rawStats.totalPaid,
        burned:           0,
        cyclesPaid:       cycleMap.size,
        uniqueRecipients: rawStats.uniqueRecipients,
      };

      const topEarners = rawEarners.map(r => ({ addr: r.recipient, total: Number(r.total), payouts: Number(r.payouts), best: Number(r.best), last_ts: r.last_ts }));
      const topStakers24h = rawTopStakers.map(r => ({ addr: r.user_addr, total: Number(r.total), deposits: Number(r.deposits) }));
      _cache = { stats, cycleHistory, topEarners, recentPayouts, topStakers24h };
      _cacheTs = Date.now();
    }
    let currentBalance = null;
    try { currentBalance = await fetchVaultBalance(); } catch { /* non-critical */ }
    return NextResponse.json({ ..._cache, currentBalance });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
