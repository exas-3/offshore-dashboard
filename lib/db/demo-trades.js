import { getDb } from './connection.js';
import { nowCap } from '../demo-clock.js';
const db = () => getDb();

// Historical "active trades at time T", reconstructed from settled game-op
// MINT rows. A settled op at timestamp ts with duration D ran [ts−D, ts), so
// it was active at T ⇔ ts > T AND ts − D <= T. The `companies` table is
// mutable current-state and can't answer this historically.
//
// Known bounded skew (accepted): completed trades key on claim time (claim ≥
// scheduled end), busted trades assume the full duration, and hit-terminated
// trades never emit a game-op MINT so they're absent (no false positives).
// PARTIAL rows are excluded — their duration is unknown until re-resolved.

export async function getActiveTradesAt(asOf, { owner = null } = {}) {
  const { now } = nowCap(asOf);
  // DISTINCT ON (hash): a settlement tx can carry multiple MINT legs — one
  // trade per tx is what the boards want (duplicate keys otherwise).
  const rows = await db()`
    SELECT * FROM (
      SELECT DISTINCT ON (t.hash)
             t.hash, t.to_addr AS owner, t.op_type, t.result,
             t.timestamp::bigint AS end_time,
             (t.timestamp::bigint - (CASE t.op_type WHEN 'EXTORTION' THEN 300 WHEN 'ARMS_DEAL' THEN 1800 ELSE 5400 END))::bigint AS start_time
      FROM transfers t
      WHERE t.kind = 'MINT'
        AND t.op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION')
        AND t.timestamp >  ${now}
        AND t.timestamp <= ${now + 5400}
        AND t.timestamp - (CASE t.op_type WHEN 'EXTORTION' THEN 300 WHEN 'ARMS_DEAL' THEN 1800 ELSE 5400 END) <= ${now}
        ${owner ? db()`AND t.to_addr = ${owner.toLowerCase()}` : db()``}
      ORDER BY t.hash, t.log_index ASC
    ) s
    ORDER BY s.end_time ASC`;
  return rows.map(r => ({
    hash:      r.hash,
    owner:     r.owner,
    opType:    r.op_type,
    result:    r.result,
    endTime:   Number(r.end_time),
    startTime: Number(r.start_time),
  }));
}

export async function getActiveTradeCountsAt(asOf) {
  const { now } = nowCap(asOf);
  // Same DISTINCT ON (hash) dedup as getActiveTradesAt — a settlement tx can
  // carry up to ~50 MINT legs and plain COUNT(*) overcounts >2×. Attribute
  // each hash to its first leg (log_index) so counts sum to the list length.
  const rows = await db()`
    SELECT s.op_type AS trade_type, COUNT(*)::int AS cnt
    FROM (
      SELECT DISTINCT ON (t.hash) t.op_type
      FROM transfers t
      WHERE t.kind = 'MINT'
        AND t.op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION')
        AND t.timestamp >  ${now}
        AND t.timestamp <= ${now + 5400}
        AND t.timestamp - (CASE t.op_type WHEN 'EXTORTION' THEN 300 WHEN 'ARMS_DEAL' THEN 1800 ELSE 5400 END) <= ${now}
      ORDER BY t.hash, t.log_index ASC
    ) s
    GROUP BY s.op_type`;
  return rows;
}

// Trades whose reconstructed start_time falls in the last `windowSec` seconds
// before T — feeds the "new crimes" sidebar panel.
export async function getRecentStartsAt(asOf, windowSec = 300) {
  const all = await getActiveTradesAt(asOf);
  const { now } = nowCap(asOf);
  return all
    .filter(t => t.startTime >= now - windowSec && t.startTime <= now)
    .sort((a, b) => b.startTime - a.startTime);
}
