export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getStakingStats, getStakingHistory, getStakingRecent, getTopStakers24h } from '../../../lib/db.js';

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
      const [stats, history, recent, top24h] = await Promise.all([
        getStakingStats(),
        getStakingHistory(),
        getStakingRecent(50),
        getTopStakers24h(200),
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

      const top24hRows = top24h.map(r => ({
        user:     r.user_addr,
        total:    Number(r.total),
        deposits: Number(r.deposits),
        alias:    r.alias || null,
      }));

      _cache = { stats, dailyChart, recent: recentRows, top24h: top24hRows };
      _cacheTs = Date.now();
    }
    return NextResponse.json(_cache);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
