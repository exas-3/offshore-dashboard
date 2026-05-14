export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getStakingStats, getStakingHistory, getStakingRecent } from '../../../lib/db.js';

let _cache = null, _cacheTs = 0;
const TTL = 15_000;

export async function GET() {
  try {
    if (!_cache || Date.now() - _cacheTs >= TTL) {
      const [stats, history, recent] = await Promise.all([
        getStakingStats(),
        getStakingHistory(),
        getStakingRecent(50),
      ]);

      const fmtMinute = d => new Date(d).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        timeZone: 'UTC', hour12: false,
      });
      const minuteChart = history.map(r => ({
        label:    fmtMinute(r.minute),
        total:    Number(r.total),
        deposits: Number(r.deposits),
        stakers:  Number(r.stakers),
      }));
      const nowFloor = new Date(Math.floor(Date.now() / 60000) * 60000);
      const nowLabel = fmtMinute(nowFloor);
      if (minuteChart.length === 0 || minuteChart[minuteChart.length - 1].label !== nowLabel) {
        minuteChart.push({ label: nowLabel, total: 0, deposits: 0, stakers: 0 });
      }

      const recentRows = recent.map(r => ({
        hash:       r.hash,
        logIndex:   r.log_index,
        ts:         Number(r.timestamp),
        user:       r.user_addr,
        rotationId: Number(r.rotation_id),
        amount:     Number(r.amount),
      }));

      _cache = { stats, minuteChart, recent: recentRows };
      _cacheTs = Date.now();
    }
    return NextResponse.json(_cache);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
