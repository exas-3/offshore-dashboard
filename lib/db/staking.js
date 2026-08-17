import { getDb } from './connection.js';
import { nowCap } from '../demo-clock.js';
const db = () => getDb();

export async function getLastStakingBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_staking_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastStakingBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_staking_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}
export async function getLastStakingClaimBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_staking_claim_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastStakingClaimBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_staking_claim_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}
export async function getLastStakingRotationBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_staking_rotation_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastStakingRotationBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_staking_rotation_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}

export async function upsertStakingDeposits(rows) {
  if (!rows.length) return;
  const values = rows.map(r => ({
    hash: r.hash, log_index: r.logIndex ?? 0, block_num: r.blockNum,
    timestamp: r.timestamp, user_addr: r.userAddr,
    rotation_id: r.rotationId, amount: r.amount,
  }));
  const CHUNK = 10000;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db()`INSERT INTO staking_deposits ${db()(values.slice(i, i + CHUNK))}
      ON CONFLICT(hash, log_index) DO NOTHING`;
  }
}

export async function upsertStakingClaims(rows) {
  if (!rows.length) return;
  const values = rows.map(r => ({
    hash: r.hash, log_index: r.logIndex ?? 0, block_num: r.blockNum,
    timestamp: r.timestamp, user_addr: r.userAddr,
    rotation_id: r.rotationId, amount: r.amount,
  }));
  const CHUNK = 10000;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db()`INSERT INTO staking_claims ${db()(values.slice(i, i + CHUNK))}
      ON CONFLICT(hash, log_index) DO NOTHING`;
  }
}

export async function upsertStakingRotations(rows) {
  if (!rows.length) return;
  const values = rows.map(r => ({
    rotation_id: r.rotationId, end_time: r.endTime,
    hash: r.hash, block_num: r.blockNum,
  }));
  for (const v of values) {
    await db()`INSERT INTO staking_rotations ${db()(v)}
      ON CONFLICT(rotation_id) DO UPDATE SET end_time=EXCLUDED.end_time, hash=EXCLUDED.hash, block_num=EXCLUDED.block_num`;
  }
}

export async function getStakingStats(asOf = null) {
  const { cap } = nowCap(asOf);
  const [r] = await db()`
    SELECT
      COUNT(DISTINCT d.user_addr) AS unique_stakers,
      COUNT(*)                    AS total_deposits,
      CAST(COALESCE(SUM(d.amount), 0) - COALESCE((SELECT SUM(amount) FROM staking_claims WHERE timestamp <= ${cap}), 0)
           AS DOUBLE PRECISION)  AS total_staked,
      CAST(MAX(d.amount) AS DOUBLE PRECISION) AS max_deposit,
      MAX(d.timestamp)            AS last_ts,
      MAX(d.rotation_id)          AS current_rotation
    FROM staking_deposits d WHERE d.timestamp <= ${cap}`;
  return {
    uniqueStakers:   Number(r?.unique_stakers   ?? 0),
    totalDeposits:   Number(r?.total_deposits   ?? 0),
    totalStaked:     Number(r?.total_staked     ?? 0),
    maxDeposit:      Number(r?.max_deposit      ?? 0),
    lastTs:          r?.last_ts ?? null,
    currentRotation: Number(r?.current_rotation ?? 0),
  };
}

export async function getStakingHistory(asOf = null) {
  const { cap } = nowCap(asOf);
  return db()`
    SELECT
      minute,
      CAST(SUM(bucket_total) OVER (ORDER BY minute) AS DOUBLE PRECISION) AS total
    FROM (
      SELECT DATE_TRUNC('minute', TO_TIMESTAMP(timestamp)) AS minute,  SUM(amount) AS bucket_total FROM staking_deposits WHERE timestamp <= ${cap} GROUP BY 1
      UNION ALL
      SELECT DATE_TRUNC('minute', TO_TIMESTAMP(timestamp)) AS minute, -SUM(amount) AS bucket_total FROM staking_claims  WHERE timestamp <= ${cap} GROUP BY 1
    ) t
    ORDER BY minute ASC`;
}

export async function getStakingRecent(limit = 50, asOf = null) {
  const { cap } = nowCap(asOf);
  return db()`
    SELECT hash, log_index, timestamp, user_addr, rotation_id, amount
    FROM staking_deposits WHERE timestamp <= ${cap} ORDER BY timestamp DESC, log_index DESC LIMIT ${limit}`;
}

export async function getWalletAliases() {
  // Priority order, highest-to-lowest:
  //   alias        — Offshore game in-game display_name (most authoritative)
  //   ens_alias    — ENS / MNS name
  //   debank_alias — DeBank profile name
  // Funder aliases are only used when the wallet itself has no name.
  const rows = await db()`
    SELECT w.address,
           COALESCE(w.alias, w.ens_alias, w.debank_alias,
                    f.alias, f.ens_alias, f.debank_alias) AS name
    FROM wallet_aliases w
    LEFT JOIN wallet_aliases f ON f.address = w.funded_by
    WHERE (w.alias IS NOT NULL AND w.alias != '')
       OR w.ens_alias IS NOT NULL
       OR w.debank_alias IS NOT NULL
       OR (w.funded_by IS NOT NULL
           AND ((f.alias IS NOT NULL AND f.alias != '')
                OR f.ens_alias IS NOT NULL
                OR f.debank_alias IS NOT NULL))`;
  return Object.fromEntries(rows.map(r => [r.address, r.name]));
}

export async function getTopStakers24h(asOf = null) {
  const { cap } = nowCap(asOf);
  return db()`
    SELECT s.user_addr,
           CAST(SUM(s.amount) - COALESCE(SUM(c.amount), 0) AS DOUBLE PRECISION) AS total,
           COUNT(DISTINCT s.hash) AS deposits,
           -- alias (game display_name) takes priority over ENS / debank.
           COALESCE(a.alias, a.ens_alias, a.debank_alias,
                    f.alias, f.ens_alias, f.debank_alias) AS alias
    FROM staking_deposits s
    LEFT JOIN staking_claims c ON c.user_addr = s.user_addr AND c.rotation_id = s.rotation_id AND c.timestamp <= ${cap}
    LEFT JOIN wallet_aliases a ON a.address = s.user_addr
    LEFT JOIN wallet_aliases f ON f.address = a.funded_by
    WHERE s.timestamp <= ${cap}
    GROUP BY s.user_addr, a.alias, a.ens_alias, a.debank_alias,
             f.alias, f.ens_alias, f.debank_alias
    HAVING SUM(s.amount) - COALESCE(SUM(c.amount), 0) > 0
    ORDER BY total DESC`;
}
