import { getDb } from './connection.js';
import { nowCap } from '../demo-clock.js';
const db = () => getDb();

export async function upsertHits(rows) {
  if (!rows.length) return;
  const values = rows.map(r => ({
    tx_hash:     r.hash,
    log_index:   r.logIndex,
    block_num:   r.blockNum,
    timestamp:   r.timestamp,
    attacker:    r.attacker,
    victim:      r.victim,
    company:     r.company || '',
    mode:        r.mode ?? 0,
    completion:  r.completionBps ?? 0,
    full_payout: r.fullPayout ?? 0,
    stolen:      r.stolen ?? 0,
    kept:        r.kept ?? 0,
    cost:        r.cost ?? 0,
  }));
  const CHUNK = 5000;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db()`INSERT INTO hits ${db()(values.slice(i, i + CHUNK))}
      ON CONFLICT(tx_hash, log_index) DO NOTHING`;
  }
}

export async function getRecentHitsForAttacker(attacker, limit = 50) {
  return db()`
    SELECT tx_hash, block_num, timestamp, victim, company, mode,
           completion, full_payout, stolen, kept, cost
    FROM hits
    WHERE attacker = ${attacker.toLowerCase()}
    ORDER BY timestamp DESC LIMIT ${limit}`;
}

export async function getRecentHitsForVictim(victim, limit = 50) {
  return db()`
    SELECT tx_hash, block_num, timestamp, attacker, company, mode,
           completion, full_payout, stolen, kept, cost
    FROM hits
    WHERE victim = ${victim.toLowerCase()}
    ORDER BY timestamp DESC LIMIT ${limit}`;
}

// For each hit, find the most recent BURN row from the attacker that matches
// the hit cost (same address, same DIRTY amount, ≤200 blocks before the hit
// or in the same tx) and retag it to op_type='HIT_COST'. Idempotent — already-
// retagged rows are filtered out via the op_type='BURN' guard.
export async function retagHitCosts(hits) {
  if (!hits.length) return 0;
  let retagged = 0;
  for (const h of hits) {
    const updated = await db()`
      UPDATE transfers SET op_type = 'HIT_COST'
      WHERE (hash, log_index) IN (
        SELECT hash, log_index FROM transfers
        WHERE kind = 'BURN' AND op_type = 'BURN'
          AND from_addr = ${h.attacker.toLowerCase()}
          AND ABS(amount - ${h.cost}) < 0.001
          AND block_num BETWEEN ${h.blockNum - 200} AND ${h.blockNum}
        ORDER BY block_num DESC, log_index DESC
        LIMIT 1
      )`;
    retagged += updated.count;
  }
  return retagged;
}

export async function getHitsDashboard({ limit = 50, hoursWindow = 24, asOf = null } = {}) {
  const { now, cap } = nowCap(asOf);
  const since = now - hoursWindow * 3600;
  const [recent, summary, buckets] = await Promise.all([
    db()`
      SELECT tx_hash, block_num, timestamp, attacker, victim, company,
             completion, full_payout, stolen, kept, cost
      FROM hits WHERE timestamp <= ${cap} ORDER BY timestamp DESC LIMIT ${limit}`,
    db()`
      SELECT
        COUNT(*)::int                                            AS total,
        COUNT(*) FILTER (WHERE stolen > cost)::int               AS wins,
        COUNT(*) FILTER (WHERE stolen <= cost)::int              AS losses,
        COALESCE(SUM(cost)::float, 0)                            AS burned_total,
        COALESCE(SUM(stolen)::float, 0)                          AS stolen_total,
        COALESCE(SUM(kept)::float, 0)                            AS kept_total
      FROM hits WHERE timestamp >= ${since} AND timestamp <= ${now}`,
    db()`
      SELECT (timestamp / 3600 * 3600)::bigint AS ts,
             COUNT(*)::int                          AS n,
             COUNT(*) FILTER (WHERE stolen > cost)::int AS wins,
             COALESCE(SUM(cost)::float, 0)              AS burned,
             COALESCE(SUM(stolen)::float, 0)            AS stolen
      FROM hits WHERE timestamp >= ${since} AND timestamp <= ${now}
      GROUP BY ts ORDER BY ts ASC`,
  ]);
  const s = summary[0] ?? {};
  const total = Number(s.total ?? 0);
  return {
    recent,
    summary: {
      total,
      wins:    Number(s.wins ?? 0),
      losses:  Number(s.losses ?? 0),
      winRate: total > 0 ? Number(s.wins) / total : 0,
      burnedTotal: Number(s.burned_total ?? 0),
      stolenTotal: Number(s.stolen_total ?? 0),
      keptTotal:   Number(s.kept_total ?? 0),
    },
    buckets,
  };
}
