export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getStakingStats, getStakingHistory, getStakingRecent } from '../../../lib/db.js';

let _cache = null, _cacheTs = 0;
const TTL = 15_000;

function fmtMinute(date) {
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', hour12: false,
  });
}

export async function GET() {
  try {
    if (!_cache || Date.now() - _cacheTs >= TTL) {
      const [stats, history, recent] = await Promise.all([
        getStakingStats(),
        getStakingHistory(),
        getStakingRecent(50),
      ]);

      const dailyChart = history.map(r => ({
        label: fmtMinute(r.minute),
        total: Number(r.total),
      }));

      const recentRows = recent.map(r => ({
        hash:       r.hash,
        logIndex:   r.log_index,
        ts:         Number(r.timestamp),
        user:       r.user_addr,
        rotationId: Number(r.rotation_id),
        amount:     Number(r.amount),
      }));

      _cache = { stats, dailyChart, recent: recentRows };
      _cacheTs = Date.now();
    }
    return NextResponse.json(_cache);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
