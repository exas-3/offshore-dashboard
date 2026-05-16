import { getDb, PROTOCOL_ADDRS, DEX_POOLS } from './connection.js';
const db = () => getDb();

export async function saveTokenInfoSnapshot(supply, holders, ts = null) {
  const t = ts ?? Math.floor(Date.now() / 1000);
  await db()`INSERT INTO supply_snapshots(timestamp, supply, holders) VALUES(${t}, ${supply}, ${holders})`;
}

export async function saveEthPriceSnapshot(price) {
  const t = Math.floor(Date.now() / 1000);
  await db()`INSERT INTO eth_price_snapshots(timestamp, price_usd) VALUES(${t}, ${price})`;
}

export async function cleanupOldEthPrices() {
  const cutoff = Math.floor(Date.now() / 1000) - 25 * 3600;
  await db()`DELETE FROM eth_price_snapshots WHERE timestamp < ${cutoff}`;
}

export async function savePriceSnapshot(dirty, infCost) {
  const t = Math.floor(Date.now() / 1000);
  if (dirty == null && infCost == null) return;
  await db()`INSERT INTO price_snapshots(timestamp, dirty, inf_cost) VALUES(${t}, ${dirty ?? null}, ${infCost ?? null})`;
}

export async function getPriceBaseline25h() {
  const target = Math.floor(Date.now() / 1000) - 24 * 3600;
  const [dirty] = await db()`
    SELECT dirty FROM price_snapshots
    WHERE dirty IS NOT NULL
    ORDER BY ABS(timestamp - ${target}) ASC LIMIT 1`;
  const [infCost] = await db()`
    SELECT inf_cost FROM price_snapshots
    WHERE inf_cost IS NOT NULL
    ORDER BY ABS(timestamp - ${target}) ASC LIMIT 1`;
  const [eth] = await db()`
    SELECT price_usd FROM eth_price_snapshots
    ORDER BY ABS(timestamp - ${target}) ASC LIMIT 1`;
  return {
    dirty:   dirty?.dirty   ?? null,
    infCost: infCost?.inf_cost ?? null,
    eth:     eth?.price_usd ?? null,
  };
}

export async function getLatestTokenInfo() {
  const [latest] = await db()`SELECT supply, holders FROM supply_snapshots ORDER BY timestamp DESC LIMIT 1`;
  if (!latest) return { supply: null, holders: null };
  if (latest.holders == null) {
    const [withH] = await db()`SELECT holders FROM supply_snapshots WHERE holders IS NOT NULL ORDER BY timestamp DESC LIMIT 1`;
    return { supply: latest.supply, holders: withH?.holders ?? null };
  }
  return { supply: latest.supply, holders: latest.holders };
}

export async function getLatestEthPrice() {
  const [row] = await db()`SELECT price_usd FROM eth_price_snapshots ORDER BY timestamp DESC LIMIT 1`;
  return row?.price_usd ?? null;
}

export async function getSupplyHistory(hours = 24) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  return db()`
    SELECT supply FROM supply_snapshots WHERE timestamp >= ${since} ORDER BY timestamp ASC`;
}

export async function getEthPriceHistory(hours = 24) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  return db()`
    SELECT timestamp, price_usd FROM eth_price_snapshots WHERE timestamp >= ${since} ORDER BY timestamp ASC`;
}

export async function getSupplyHistoryBuckets(unit = 86400) {
  const part = unit === 86400
    ? `DATE(TO_TIMESTAMP(timestamp::float))`
    : `DATE_TRUNC('hour', TO_TIMESTAMP(timestamp::float))`;
  const rows = await db().unsafe(`
    SELECT supply FROM (
      SELECT timestamp, supply,
        ROW_NUMBER() OVER (PARTITION BY ${part} ORDER BY timestamp DESC) AS rn
      FROM supply_snapshots
    ) t WHERE rn = 1 ORDER BY timestamp ASC
  `);
  return rows.map(r => ({ supply: r.supply }));
}

export async function getDaysNeedingSupplyBackfill() {
  return db()`
    SELECT block_num, day_ts FROM (
      SELECT DISTINCT
        CAST(FLOOR(MIN(timestamp) OVER (PARTITION BY DATE(TO_TIMESTAMP(timestamp::float))) / 86400) * 86400 AS BIGINT) AS day_ts,
        MIN(block_num)  OVER (PARTITION BY DATE(TO_TIMESTAMP(timestamp::float))) AS block_num,
        DATE(TO_TIMESTAMP(timestamp::float)) AS day
      FROM transfers
    ) t
    WHERE NOT EXISTS (
      SELECT 1 FROM supply_snapshots s
      WHERE s.timestamp BETWEEN t.day_ts AND t.day_ts + 86399
    )
    ORDER BY day_ts ASC LIMIT 30`;
}

export async function getHoursNeedingSupplyBackfill() {
  return db()`
    SELECT block_num, hour_ts FROM (
      SELECT DISTINCT
        CAST(FLOOR(MIN(timestamp) OVER (PARTITION BY DATE_TRUNC('hour',TO_TIMESTAMP(timestamp::float))) / 3600) * 3600 AS BIGINT) AS hour_ts,
        MIN(block_num) OVER (PARTITION BY DATE_TRUNC('hour',TO_TIMESTAMP(timestamp::float))) AS block_num,
        DATE_TRUNC('hour',TO_TIMESTAMP(timestamp::float)) AS hr
      FROM transfers
    ) t
    WHERE NOT EXISTS (
      SELECT 1 FROM supply_snapshots s
      WHERE s.timestamp BETWEEN t.hour_ts AND t.hour_ts + 3599
    )
    ORDER BY hour_ts ASC LIMIT 50`;
}

export async function computeHolderBalances(limit = 500) {
  const rows = await db()`
    SELECT addr, SUM(delta) AS balance FROM (
      SELECT to_addr   AS addr,  SUM(amount) AS delta FROM transfers GROUP BY to_addr
      UNION ALL
      SELECT from_addr AS addr, -SUM(amount) AS delta FROM transfers GROUP BY from_addr
    ) t GROUP BY addr
    HAVING SUM(delta) > 0.0001
    ORDER BY SUM(delta) DESC LIMIT ${limit}`;
  return rows.map(r => ({ addr: r.addr, balance: Number(r.balance) }));
}

export async function computeTrueHolderCount() {
  const [row] = await db()`
    SELECT COUNT(*) AS cnt FROM (
      SELECT addr FROM (
        SELECT to_addr AS addr, SUM(amount) AS delta FROM transfers GROUP BY to_addr
        UNION ALL
        SELECT from_addr, -SUM(amount) FROM transfers GROUP BY from_addr
      ) t GROUP BY addr HAVING SUM(delta) > 0.0001
    ) u`;
  return Number(row?.cnt ?? 0);
}

export async function upsertHolders(holders) {
  if (!holders.length) return;
  const values = holders.map(h => ({
    address: h.address, balance: h.balance, balance_raw: h.balanceRaw,
    rank: h.rank, is_contract: !!h.isContract, last_snapshot: h.lastSnapshot,
  }));
  await db()`INSERT INTO token_holders ${db()(values)}
    ON CONFLICT(address) DO UPDATE SET
      balance = EXCLUDED.balance, balance_raw = EXCLUDED.balance_raw,
      rank = EXCLUDED.rank, is_contract = EXCLUDED.is_contract,
      last_snapshot = EXCLUDED.last_snapshot`;
}

export async function getKnownIsContract() {
  const rows = await db()`SELECT address, is_contract FROM token_holders`;
  return new Map(rows.map(r => [r.address, r.is_contract ? 1 : 0]));
}

export async function getWhales(limit = 25, excludeAddresses = []) {
  const rows = excludeAddresses.length > 0
    ? await db()`SELECT address, balance, is_contract FROM token_holders
        WHERE address != ALL(${excludeAddresses}) ORDER BY rank ASC LIMIT ${limit}`
    : await db()`SELECT address, balance, is_contract FROM token_holders
        ORDER BY rank ASC LIMIT ${limit}`;
  return rows.map(r => ({ address: r.address, balance: r.balance, isContract: r.is_contract }));
}

export async function getHolderCount() {
  const [row] = await db()`SELECT COUNT(*) AS cnt FROM token_holders WHERE balance > 0`;
  return Number(row?.cnt ?? 0);
}

export async function getTopEarners(limit = 100) {
  return db()`
    SELECT to_addr AS address, CAST(SUM(amount) AS BIGINT) AS earned, COUNT(*) AS ops
    FROM transfers WHERE kind = 'MINT' AND NOT (kind = 'MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))
    GROUP BY to_addr ORDER BY earned DESC LIMIT ${limit}`;
}

export async function getDexActivity(since = 0, limit = 50) {
  return db()`
    SELECT hash, log_index, timestamp, from_addr, to_addr, amount, kind, op_type
    FROM transfers
    WHERE kind = 'TRANSFER'
      AND (op_type IN ('DEX_BUY','DEX_SELL') OR from_addr = ANY(${DEX_POOLS}) OR to_addr = ANY(${DEX_POOLS}))
      AND timestamp > ${since}
    ORDER BY timestamp DESC, log_index DESC LIMIT ${limit}`;
}

export async function getWalletActivity(addresses, limit = 100, since = 0) {
  return db()`
    SELECT hash, log_index, timestamp, from_addr, to_addr, amount, kind, op_type
    FROM transfers
    WHERE (to_addr = ANY(${addresses}) OR from_addr = ANY(${addresses}))
      AND timestamp > ${since}
    ORDER BY timestamp DESC, log_index DESC LIMIT ${limit}`;
}

export async function getWalletDexSummary(addresses) {
  if (!addresses.length) return {};
  const rows = await db()`
    SELECT
      CASE WHEN to_addr = ANY(${DEX_POOLS}) THEN from_addr ELSE to_addr END AS addr,
      SUM(CASE WHEN to_addr   = ANY(${DEX_POOLS}) OR op_type='DEX_SELL' THEN amount ELSE 0 END) AS sold,
      SUM(CASE WHEN from_addr = ANY(${DEX_POOLS}) OR op_type='DEX_BUY'  THEN amount ELSE 0 END) AS bought
    FROM transfers
    WHERE kind = 'TRANSFER'
      AND (op_type IN ('DEX_BUY','DEX_SELL') OR from_addr = ANY(${DEX_POOLS}) OR to_addr = ANY(${DEX_POOLS}))
      AND (from_addr = ANY(${addresses}) OR to_addr = ANY(${addresses}))
    GROUP BY addr`;
  const map = {};
  rows.forEach(r => { map[r.addr] = { sold: r.sold, bought: r.bought }; });
  return map;
}
