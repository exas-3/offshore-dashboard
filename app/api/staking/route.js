export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getStakingStats, getStakingHistory, getStakingRecent, getTopStakers24h } from '../../../lib/index.js';
import { resolveAsOf, bucketAt, DEMO_CACHE_HEADERS } from '../../../lib/demo-clock.js';

const _cache = new Map();
const TTL = 15_000;
const CACHE_MAX = 32;

function fmtMinute(date) {
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', hour12: false,
  });
}

export async function GET(request) {
  try {
    const asOf = resolveAsOf(request);
    const demo = asOf != null;
    const key  = demo ? String(bucketAt(asOf, 60)) : 'live';
    const headers = demo ? DEMO_CACHE_HEADERS : {};
    const hit = _cache.get(key);
    if (!hit || (!demo && Date.now() - hit.ts >= TTL)) {
      const [stats, history, recent, top24h] = await Promise.all([
        getStakingStats(asOf),
        getStakingHistory(asOf),
        getStakingRecent(50, asOf),
        getTopStakers24h(asOf),
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

      _cache.set(key, { data: { stats, dailyChart, recent: recentRows, top24h: top24hRows }, ts: Date.now() });
      while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
    }
    return NextResponse.json(_cache.get(key).data, { headers });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
