export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getVaultStats, getVaultCycleHistory, getVaultTopEarners, getVaultRecentPayouts, getVaultFirstPayouts, getTopStakers24h } from '../../../lib/index.js';
import { fetchVaultBalance } from '../../../server/etherscan.js';

// ── cycle boundary logic (mirrors stats/route.js) ─────────────────────────────
const WEEKDAY_ANCHOR = 5400;       // 01:30 UTC — first weekday cycle start of day
const WEEKDAY_DUR    = 8  * 3600;  // 8 hours
const WEEKEND_ANCHOR = 9 * 3600 + 30 * 60;  // 09:30 UTC

function isWeekendTs(ts) {
  const d   = new Date(ts * 1000);
  const dow = d.getUTCDay();
  const s   = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  if (dow === 6 && s >= WEEKEND_ANCHOR) return true;
  if (dow === 0) return true;
  if (dow === 1 && s < WEEKEND_ANCHOR) return true;
  return false;
}

// Returns the Unix timestamp of the start of the cycle that contains ts.
function getCycleStart(ts) {
  if (!isWeekendTs(ts)) {
    return Math.floor((ts - WEEKDAY_ANCHOR) / WEEKDAY_DUR) * WEEKDAY_DUR + WEEKDAY_ANCHOR;
  }
  // Weekend: 24h cycles anchored at WEEKEND_ANCHOR each day (Sat 09:30, Sun 09:30)
  const d = new Date(ts * 1000);
  const s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  const dayStart = ts - s;
  return s >= WEEKEND_ANCHOR ? dayStart + WEEKEND_ANCHOR : dayStart - 86400 + WEEKEND_ANCHOR;
}

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
