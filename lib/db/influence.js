import { getDb } from './connection.js';
import { nowCap } from '../demo-clock.js';
const db = () => getDb();

export async function upsertInfluenceTransfers(rows) {
  if (!rows.length) return;
  const values = rows.map(r => ({
    hash: r.hash, log_index: r.logIndex ?? 0, block_num: r.blockNum,
    timestamp: r.timestamp, from_addr: r.fromAddr, to_addr: r.toAddr,
    amount: r.amount, kind: r.kind,
  }));
  // 8 columns per row — stay under postgres's 65534-parameter limit
  const CHUNK = 8000;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db()`INSERT INTO influence_transfers ${db()(values.slice(i, i + CHUNK))}
      ON CONFLICT(hash, log_index) DO NOTHING`;
  }
}

export async function saveInfluenceSupply(supply) {
  const t = Math.floor(Date.now() / 1000);
  await db()`INSERT INTO influence_supply_snapshots(timestamp, supply) VALUES(${t}, ${supply})`;
}

export async function getLatestInfluenceSupply() {
  const [row] = await db()`SELECT supply FROM influence_supply_snapshots ORDER BY timestamp DESC LIMIT 1`;
  return row?.supply ?? null;
}

export async function getInfluenceStats(asOf = null) {
  const { cap } = nowCap(asOf);
  const [r] = await db()`
    SELECT
      CAST(SUM(CASE WHEN kind='MINT' THEN amount ELSE 0 END) AS BIGINT) AS total_minted,
      CAST(SUM(CASE WHEN kind='BURN' THEN amount ELSE 0 END) AS BIGINT) AS total_burned,
      COUNT(DISTINCT CASE WHEN kind='MINT' THEN to_addr END) AS unique_earners,
      CAST(SUM(CASE WHEN kind='MINT' AND EXISTS(
        SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1
      ) THEN amount ELSE 0 END) AS BIGINT) AS total_refunded,
      CAST(SUM(CASE WHEN kind='MINT' AND NOT EXISTS(
        SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1
      ) THEN amount ELSE 0 END) AS BIGINT) AS total_purchased
    FROM influence_transfers WHERE timestamp > 0 AND timestamp <= ${cap}`;
  const [inf] = await db()`SELECT supply FROM influence_supply_snapshots WHERE timestamp <= ${cap} ORDER BY timestamp DESC LIMIT 1`;
  return {
    totalMinted:   Number(r?.total_minted   ?? 0),
    totalBurned:   Number(r?.total_burned   ?? 0),
    totalRefunded: Number(r?.total_refunded ?? 0),
    totalPurchased:Number(r?.total_purchased?? 0),
    circulating:   inf?.supply ?? null,
    uniqueEarners: Number(r?.unique_earners ?? 0),
  };
}

export async function getInfluenceDaily(asOf = null) {
  const { cap } = nowCap(asOf);
  return db()`SELECT day_ts, purchased, consumed, refunded, net FROM influence_daily WHERE day_ts <= ${cap} ORDER BY day_ts ASC`;
}

export async function getInfluenceBuckets(unit, asOf = null) {
  const { now, cap } = nowCap(asOf);
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM influence_transfers WHERE kind IN ('MINT','BURN') AND timestamp > 0 AND timestamp <= ${cap}`;
  if (!first?.ts) return [];
  const startTs  = Math.floor(Number(first.ts) / unit) * unit;
  const numSlots = Math.max(1, Math.floor((now - startTs) / unit) + 1);
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      CAST(SUM(CASE WHEN kind='MINT' THEN amount ELSE 0 END) AS BIGINT) AS minted,
      CAST(SUM(CASE WHEN kind='BURN' THEN amount ELSE 0 END) AS BIGINT) AS burned,
      CAST(SUM(CASE WHEN kind='MINT' AND NOT EXISTS(
        SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1
      ) THEN amount ELSE 0 END) AS BIGINT) AS purchased
    FROM influence_transfers WHERE kind IN ('MINT','BURN') AND timestamp > 0 AND timestamp <= ${cap}
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), r]));
  const tss = Array.from({ length: numSlots }, (_, i) => startTs + i * unit);
  return tss.map((ts, i) => ({
    ts,
    minted:    Number(map.get(i)?.minted    ?? 0),
    burned:    Number(map.get(i)?.burned    ?? 0),
    purchased: Number(map.get(i)?.purchased ?? 0),
  }));
}
