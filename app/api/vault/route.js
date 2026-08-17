export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getVaultStats, getVaultCycleHistory, getVaultTopEarners, getVaultRecentPayouts, getVaultFirstPayouts, getTopStakers24h } from '../../../lib/index.js';
import { fetchVaultBalance } from '../../../server/etherscan.js';
import { getCycleStart } from '../offshore-data/helpers.js';
import { resolveAsOf, bucketAt, DEMO_CACHE_HEADERS } from '../../../lib/demo-clock.js';

function fmtCycleLabel(ts) {
  const d = new Date(ts * 1000);
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  const hh  = String(d.getUTCHours()).padStart(2, '0');
  const mm  = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mon} ${day} ${hh}:${mm}`;
}

const _cache = new Map();
const TTL = 15_000;
const CACHE_MAX = 32;

export async function GET(request) {
  try {
    const asOf = resolveAsOf(request);
    const demo = asOf != null;
    const key  = demo ? String(bucketAt(asOf, 60)) : 'live';
    const headers = demo ? DEMO_CACHE_HEADERS : {};
    let entry = _cache.get(key);
    if (!entry || (!demo && Date.now() - entry.ts >= TTL)) {
      const [rawStats, rawPayouts, rawEarners, recentPayouts, firstPayouts, rawTopStakers] = await Promise.all([
        getVaultStats(asOf), getVaultCycleHistory(asOf), getVaultTopEarners(50, asOf), getVaultRecentPayouts(100, asOf), getVaultFirstPayouts(asOf), getTopStakers24h(asOf),
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
      entry = { data: { stats, cycleHistory, topEarners, recentPayouts, topStakers24h }, ts: Date.now() };
      _cache.set(key, entry);
      while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
    }
    let currentBalance = null;
    if (!demo) {
      try { currentBalance = await fetchVaultBalance(); } catch { /* non-critical */ }
    }
    return NextResponse.json({ ...entry.data, currentBalance }, { headers });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
