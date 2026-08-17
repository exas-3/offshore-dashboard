export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db/connection.js';
import { resolveAsOf, nowCap, bucketAt } from '../../../lib/demo-clock.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };
let _cache = new Map(); // keyed on cycle_id (+asOf bucket)
const TTL = 60_000;
const CACHE_MAX = 32;

export async function GET(req) {
  try {
    const url = new URL(req.url);
    let cycleId = Number(url.searchParams.get('cycle'));
    const limit = Math.min(500, Number(url.searchParams.get('limit')) || 100);
    const asOf = resolveAsOf(req);
    const { cap } = nowCap(asOf);

    const db = getDb();

    // Default to the most recent cycle present in cycle_rewards as of the
    // viewing moment (created_at is the API-ingest time — ±hours precision).
    if (!cycleId || !Number.isFinite(cycleId)) {
      const [latest] = await db`SELECT MAX(cycle_id)::int AS m FROM cycle_rewards WHERE created_at <= to_timestamp(${cap})`;
      cycleId = latest?.m ?? 1;
    }

    const cacheKey = `${cycleId}:${limit}:${asOf != null ? bucketAt(asOf, 300) : 'live'}`;
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TTL) {
      return NextResponse.json(cached.data, { headers: CORS });
    }

    // Top earners for that cycle, joined with alias + label so the UI can
    // render the chip + name without an extra round-trip.
    const rows = await db`
      SELECT
        cr.user_address                         AS address,
        cr.reward_amount_wei,
        cr.total_flux,
        cr.loadout_count,
        COALESCE(w.alias, w.ens_alias, w.debank_alias) AS alias,
        w.label                                 AS label
      FROM cycle_rewards cr
      LEFT JOIN wallet_aliases w ON w.address = cr.user_address
      WHERE cr.cycle_id = ${cycleId} AND cr.created_at <= to_timestamp(${cap})
      ORDER BY cr.reward_amount_wei::numeric DESC
      LIMIT ${limit}`;

    // Convert wei → USD float (USDM has 18 decimals).
    const items = rows.map((r, i) => ({
      rank:     i + 1,
      address:  r.address,
      alias:    r.alias || null,
      label:    r.label || null,
      reward:   Number(r.reward_amount_wei) / 1e18,
      flux:     Number(r.total_flux) || 0,
      loadouts: r.loadout_count,
    }));

    // List of cycles for the dropdown.
    const cycles = await db`
      SELECT cycle_id::int AS id, COUNT(*)::int AS users, SUM(reward_amount_wei::numeric)/1e18 AS pool
      FROM cycle_rewards
      WHERE created_at <= to_timestamp(${cap})
      GROUP BY cycle_id
      ORDER BY cycle_id DESC`;

    const data = {
      cycle: cycleId,
      cycles: cycles.map(c => ({ id: c.id, users: c.users, pool: Number(c.pool) })),
      items,
    };
    _cache.set(cacheKey, { ts: Date.now(), data });
    while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
    return NextResponse.json(data, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
