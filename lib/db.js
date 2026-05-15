import postgres from 'postgres';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  // Log warning but don't crash — allows `next build` without a DB
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[db] DATABASE_URL not set — queries will fail');
  }
}

let _sql;
export function sql() { return _sql; }

export function getDb() {
  if (!_sql && DB_URL) {
    _sql = postgres(DB_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      ssl: DB_URL.includes('localhost') || DB_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
    });
  }
  return _sql;
}

// Lazily-initialised — call getDb() inside every function so the module
// can be imported during build without a live database.
function db() {
  return getDb();
}

const ZERO_ADDR      = '0x0000000000000000000000000000000000000000';
const PROTOCOL_ADDRS = ['0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462'];
const DEX_POOLS      = [
  '0xf9f676066eb7baeeed93e859bc26a41663f277a8',  // main pool
  '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1',  // legacy pool
];

// ─── meta ─────────────────────────────────────────────────────────────────────

export async function getLastBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}

export async function getLastInfluenceBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_influence_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastInfluenceBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_influence_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}

export async function getLastVaultBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_vault_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastVaultBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_vault_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}

export async function getLastLiqBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_liq_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastLiqBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_liq_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}

// Inserts FAIL (liquidation) records sourced from idx_logs into transfers.
// fromBlock/toBlock allow incremental syncing.
export async function syncLiquidationsFromIdx(fromBlock, toBlock) {
  const FACTORY  = '0x619814a203ca441611cee02abf31986ca265dd35';
  const E_EXITED = '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff';
  const E_PAYOUT = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502';
  const GENESIS  = 1762797011;
  const result = await db()`
    INSERT INTO transfers (hash, log_index, block_num, timestamp, from_addr, to_addr, raw_value, amount, kind, op_type)
    SELECT
      il.tx_hash,
      il.log_index,
      il.block_num,
      (il.block_num + ${GENESIS})::bigint,
      '0x0000000000000000000000000000000000000000',
      ('0x' || LOWER(RIGHT(il.topic1, 40))),
      '0',
      0,
      'MINT',
      'FAIL'
    FROM idx_logs il
    WHERE il.address = ${FACTORY}
      AND il.topic0 = ${E_EXITED}
      AND il.block_num > ${fromBlock}
      AND il.block_num <= ${toBlock}
      AND NOT EXISTS (
        SELECT 1 FROM idx_logs s WHERE s.tx_hash = il.tx_hash
          AND s.address = ${FACTORY} AND s.topic0 = ${E_PAYOUT}
      )
    ON CONFLICT (hash, log_index) DO NOTHING
  `;
  return result.count ?? 0;
}

// ─── transfers ────────────────────────────────────────────────────────────────

export async function upsertTransfers(rows) {
  if (!rows.length) return;
  const values = rows.map(r => ({
    hash: r.hash, log_index: r.logIndex ?? 0, block_num: r.blockNum,
    timestamp: r.timestamp, from_addr: r.fromAddr, to_addr: r.toAddr,
    raw_value: r.rawValue ?? String(r.amount), amount: r.amount,
    kind: r.kind, op_type: r.opType ?? '',
  }));
  // 10 columns per row — stay under postgres's 65534-parameter limit
  const CHUNK = 6000;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db()`INSERT INTO transfers ${db()(values.slice(i, i + CHUNK))}
      ON CONFLICT(hash, log_index) DO NOTHING`;
  }
}

export async function getRecentTransfers(limit = 100, offset = 0) {
  return db()`SELECT hash, log_index, timestamp, from_addr, to_addr, amount, kind, op_type
    FROM transfers ORDER BY timestamp DESC, log_index DESC LIMIT ${limit} OFFSET ${offset}`;
}

export async function getTotalTransferCount() {
  const [row] = await db()`SELECT COUNT(*) AS cnt FROM transfers`;
  return Number(row?.cnt ?? 0);
}

export async function getDistinctMintHashes() {
  const rows = await db()`SELECT DISTINCT hash FROM transfers WHERE kind = 'MINT'`;
  return rows.map(r => r.hash.toLowerCase());
}

export async function getDistinctSpendHashes() {
  const rows = await db()`SELECT DISTINCT hash FROM transfers WHERE kind = 'SPEND'`;
  return rows.map(r => r.hash.toLowerCase());
}

// Updates op_type for rows of the given kind by tx hash. updates: Map<hash, opType>
export async function batchUpdateMintOpTypes(updates, kind = 'MINT') {
  if (!updates.size) return 0;
  let count = 0;
  for (const [hash, opType] of updates) {
    const result = await db()`
      UPDATE transfers SET op_type = ${opType}
      WHERE hash = ${hash} AND kind = ${kind} AND op_type != ${opType}`;
    count += result.count ?? 0;
  }
  return count;
}

// ─── stats ────────────────────────────────────────────────────────────────────

export async function getStats() {
  const [mint] = await db()`
    SELECT CAST(SUM(amount) AS BIGINT) AS total, COUNT(DISTINCT to_addr) AS addrs
    FROM transfers WHERE kind = 'MINT' AND to_addr != ${ZERO_ADDR}`;
  const [spend] = await db()`
    SELECT CAST(SUM(amount) AS BIGINT) AS total, COUNT(*) AS ops
    FROM transfers WHERE kind IN ('SPEND','BURN')`;
  const [addrCount] = await db()`
    SELECT COUNT(DISTINCT to_addr) AS cnt FROM transfers WHERE kind = 'MINT' AND to_addr != ${ZERO_ADDR}`;
  return {
    dirtyMintedTotal: Number(mint?.total ?? 0),
    dirtySpentTotal:  Number(spend?.total ?? 0),
    opsTotal:         Number(spend?.ops ?? 0),
    uniqueAddrs:      Number(addrCount?.cnt ?? 0),
  };
}

export async function getOpBreakdown() {
  const rows = await db()`
    SELECT op_type, COUNT(*) AS cnt, CAST(SUM(amount) AS BIGINT) AS total
    FROM transfers WHERE kind IN ('SPEND','BURN')
    GROUP BY op_type ORDER BY total DESC`;
  return rows.map(r => ({ opType: r.op_type, cnt: Number(r.cnt), total: Number(r.total) }));
}

// ─── token info ───────────────────────────────────────────────────────────────

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

// ─── supply history chart ─────────────────────────────────────────────────────

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

// ─── supply backfill helpers ──────────────────────────────────────────────────

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

// ─── token holders ────────────────────────────────────────────────────────────

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

// ─── top earners ──────────────────────────────────────────────────────────────

export async function getTopEarners(limit = 100) {
  return db()`
    SELECT to_addr AS address, CAST(SUM(amount) AS BIGINT) AS earned, COUNT(*) AS ops
    FROM transfers WHERE kind = 'MINT' AND NOT (kind = 'MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))
    GROUP BY to_addr ORDER BY earned DESC LIMIT ${limit}`;
}

// ─── dex activity ─────────────────────────────────────────────────────────────

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

// ─── influence ────────────────────────────────────────────────────────────────

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

export async function getInfluenceStats() {
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
    FROM influence_transfers WHERE timestamp > 0`;
  const [inf] = await db()`SELECT supply FROM influence_supply_snapshots ORDER BY timestamp DESC LIMIT 1`;
  return {
    totalMinted:   Number(r?.total_minted   ?? 0),
    totalBurned:   Number(r?.total_burned   ?? 0),
    totalRefunded: Number(r?.total_refunded ?? 0),
    totalPurchased:Number(r?.total_purchased?? 0),
    circulating:   inf?.supply ?? null,
    uniqueEarners: Number(r?.unique_earners ?? 0),
  };
}

// ─── vault ────────────────────────────────────────────────────────────────────

export async function upsertVaultPayouts(rows) {
  if (!rows.length) return;
  const values = rows.map(r => ({
    hash: r.hash, log_index: r.logIndex ?? 0, block_num: r.blockNum,
    timestamp: r.timestamp, recipient: r.recipient, amount: r.amount,
  }));
  // 6 columns per row — stay under postgres's 65534-parameter limit
  const CHUNK = 10000;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db()`INSERT INTO vault_payouts ${db()(values.slice(i, i + CHUNK))}
      ON CONFLICT(hash, log_index) DO NOTHING`;
  }
}

export async function getVaultStats() {
  const [r] = await db()`
    SELECT
      COUNT(DISTINCT recipient) AS unique_recipients,
      COUNT(*) AS total_payouts,
      CAST(SUM(amount) AS DOUBLE PRECISION) AS total_paid,
      CAST(MAX(amount) AS DOUBLE PRECISION) AS max_payout,
      CAST(AVG(amount) AS DOUBLE PRECISION) AS avg_payout,
      MAX(timestamp) AS last_payout_ts
    FROM vault_payouts`;
  return {
    uniqueRecipients: Number(r?.unique_recipients ?? 0),
    totalPayouts:     Number(r?.total_payouts     ?? 0),
    totalPaid:        Number(r?.total_paid        ?? 0),
    maxPayout:        Number(r?.max_payout        ?? 0),
    avgPayout:        Number(r?.avg_payout        ?? 0),
    lastPayoutTs:     r?.last_payout_ts ?? null,
  };
}

// Returns raw payout rows so the caller can bucket them by actual cycle
// (weekday = 8h, weekend = 24h — hard to express cleanly in SQL).
export async function getVaultCycleHistory() {
  return db()`SELECT timestamp, amount FROM vault_payouts ORDER BY timestamp ASC`;
}

export async function getVaultTopEarners(limit = 50) {
  return db()`
    SELECT recipient, COUNT(*) AS payouts,
      CAST(SUM(amount) AS DOUBLE PRECISION) AS total,
      CAST(MAX(amount) AS DOUBLE PRECISION) AS best,
      MAX(timestamp) AS last_ts
    FROM vault_payouts
    GROUP BY recipient ORDER BY total DESC LIMIT ${limit}`;
}

export async function getVaultRecentPayouts(limit = 100) {
  return db()`
    SELECT hash, log_index, timestamp, recipient, amount
    FROM vault_payouts ORDER BY timestamp DESC, log_index DESC LIMIT ${limit}`;
}

// Returns each recipient's earliest payout timestamp — used to compute new recipients per cycle.
export async function getVaultFirstPayouts() {
  return db()`SELECT MIN(timestamp) AS first_ts FROM vault_payouts GROUP BY recipient`;
}

// ─── staking deposits ─────────────────────────────────────────────────────────

export async function getLastStakingBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_staking_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastStakingBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_staking_block',${String(n)})
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

export async function getStakingStats() {
  const [r] = await db()`
    SELECT
      COUNT(DISTINCT user_addr) AS unique_stakers,
      COUNT(*) AS total_deposits,
      CAST(SUM(amount) AS DOUBLE PRECISION) AS total_staked,
      CAST(MAX(amount) AS DOUBLE PRECISION) AS max_deposit,
      MAX(timestamp) AS last_ts,
      MAX(rotation_id) AS current_rotation
    FROM staking_deposits`;
  return {
    uniqueStakers:   Number(r?.unique_stakers   ?? 0),
    totalDeposits:   Number(r?.total_deposits   ?? 0),
    totalStaked:     Number(r?.total_staked     ?? 0),
    maxDeposit:      Number(r?.max_deposit      ?? 0),
    lastTs:          r?.last_ts ?? null,
    currentRotation: Number(r?.current_rotation ?? 0),
  };
}

export async function getStakingHistory() {
  return db()`
    SELECT
      minute,
      CAST(SUM(bucket_total) OVER (ORDER BY minute) AS DOUBLE PRECISION) AS total
    FROM (
      SELECT
        DATE_TRUNC('minute', TO_TIMESTAMP(timestamp)) AS minute,
        SUM(amount) AS bucket_total
      FROM staking_deposits
      GROUP BY 1
    ) t
    ORDER BY minute ASC`;
}

export async function getStakingRecent(limit = 50) {
  return db()`
    SELECT hash, log_index, timestamp, user_addr, rotation_id, amount
    FROM staking_deposits ORDER BY timestamp DESC, log_index DESC LIMIT ${limit}`;
}

export async function getWalletAliases() {
  const rows = await db()`
    SELECT w.address,
           COALESCE(w.ens_alias, w.alias, w.debank_alias,
                    f.ens_alias, f.alias, f.debank_alias) AS name
    FROM wallet_aliases w
    LEFT JOIN wallet_aliases f ON f.address = w.funded_by
    WHERE w.ens_alias IS NOT NULL
       OR (w.alias IS NOT NULL AND w.alias != '')
       OR w.debank_alias IS NOT NULL
       OR (w.funded_by IS NOT NULL
           AND (f.ens_alias IS NOT NULL
                OR (f.alias IS NOT NULL AND f.alias != '')
                OR f.debank_alias IS NOT NULL))`;
  return Object.fromEntries(rows.map(r => [r.address, r.name]));
}

export async function getTopStakers24h(limit = 200) {
  const since = Math.floor(Date.now() / 1000) - 86400;
  return db()`
    SELECT s.user_addr, CAST(SUM(s.amount) AS DOUBLE PRECISION) AS total, COUNT(*) AS deposits,
           COALESCE(a.ens_alias, a.alias, a.debank_alias,
                    f.ens_alias, f.alias, f.debank_alias) AS alias
    FROM staking_deposits s
    LEFT JOIN wallet_aliases a  ON a.address = s.user_addr
    LEFT JOIN wallet_aliases f  ON f.address = a.funded_by
    WHERE s.timestamp >= ${since}
    GROUP BY s.user_addr, a.ens_alias, a.alias, a.debank_alias,
             f.ens_alias, f.alias, f.debank_alias
    ORDER BY total DESC
    LIMIT ${limit}`;
}

// ─── players ──────────────────────────────────────────────────────────────────

export async function getPlayerLeaderboard(limit = 200, offset = 0) {
  return db()`
    SELECT
      addr,
      SUM(earned)     AS earned,
      SUM(ops)        AS ops,
      SUM(spent)      AS spent,
      SUM(dex_sold)   AS dex_sold,
      SUM(dex_bought) AS dex_bought,
      MAX(ts)         AS last_active
    FROM (
      SELECT to_addr   AS addr, amount AS earned, 1 AS ops, 0 AS spent, 0 AS dex_sold, 0 AS dex_bought, timestamp AS ts
        FROM transfers WHERE kind='MINT' AND to_addr != ${ZERO_ADDR}
      UNION ALL
      SELECT from_addr, 0, 0, amount, 0, 0, timestamp
        FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr != ${ZERO_ADDR} AND from_addr != ALL(${DEX_POOLS})
      UNION ALL
      SELECT from_addr, 0, 0, 0, amount, 0, timestamp
        FROM transfers WHERE kind='TRANSFER'
          AND (op_type='DEX_SELL' OR to_addr = ANY(${DEX_POOLS}))
          AND from_addr != ${ZERO_ADDR} AND from_addr != ALL(${DEX_POOLS})
      UNION ALL
      SELECT to_addr,   0, 0, 0, 0, amount, timestamp
        FROM transfers WHERE kind='TRANSFER'
          AND (op_type='DEX_BUY' OR from_addr = ANY(${DEX_POOLS}))
          AND to_addr != ${ZERO_ADDR} AND to_addr != ALL(${DEX_POOLS})
    ) t
    GROUP BY addr
    ORDER BY earned DESC
    LIMIT ${limit} OFFSET ${offset}`;
}

export async function getPlayerCount() {
  const [row] = await db()`
    SELECT COUNT(DISTINCT to_addr) AS cnt FROM transfers WHERE kind='MINT' AND to_addr != ${ZERO_ADDR}`;
  return Number(row?.cnt ?? 0);
}

export async function getPlayerStats(address) {
  const addr = address.toLowerCase();
  const [row] = await db()`
    SELECT
      SUM(earned)     AS earned,
      SUM(ops)        AS ops,
      SUM(spent)      AS spent,
      SUM(dex_sold)   AS dex_sold,
      SUM(dex_bought) AS dex_bought,
      MAX(ts)         AS last_active,
      MIN(ts)         AS first_active
    FROM (
      SELECT amount AS earned, 1 AS ops, 0 AS spent, 0 AS dex_sold, 0 AS dex_bought, timestamp AS ts
        FROM transfers WHERE kind='MINT' AND to_addr = ${addr}
      UNION ALL
      SELECT 0, 0, amount, 0, 0, timestamp
        FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr = ${addr}
      UNION ALL
      SELECT 0, 0, 0, amount, 0, timestamp
        FROM transfers WHERE kind='TRANSFER' AND from_addr = ${addr}
          AND (op_type='DEX_SELL' OR to_addr = ANY(${DEX_POOLS}))
      UNION ALL
      SELECT 0, 0, 0, 0, amount, timestamp
        FROM transfers WHERE kind='TRANSFER' AND to_addr = ${addr}
          AND (op_type='DEX_BUY' OR from_addr = ANY(${DEX_POOLS}))
    ) t`;
  const [vault] = await db()`
    SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM vault_payouts WHERE recipient = ${addr}`;
  const [holder] = await db()`SELECT balance FROM token_holders WHERE address = ${addr}`;
  return {
    earned:      Number(row?.earned      ?? 0),
    ops:         Number(row?.ops         ?? 0),
    spent:       Number(row?.spent       ?? 0),
    dex_sold:    Number(row?.dex_sold    ?? 0),
    dex_bought:  Number(row?.dex_bought  ?? 0),
    last_active: row?.last_active  ?? null,
    first_active:row?.first_active ?? null,
    vault_claimed: Number(vault?.total ?? 0),
    vault_count:   Number(vault?.count ?? 0),
    balance:     Number(holder?.balance ?? 0),
  };
}

export async function getPlayerActivity(address, limit = 100, offset = 0) {
  const addr = address.toLowerCase();
  return db()`
    SELECT hash, log_index, timestamp, from_addr, to_addr, amount, kind, op_type
    FROM transfers WHERE to_addr = ${addr} OR from_addr = ${addr}
    ORDER BY timestamp DESC, log_index DESC LIMIT ${limit} OFFSET ${offset}`;
}

export async function getPlayerRecentMissionStats(address) {
  const addr    = address.toLowerCase();
  const now     = Math.floor(Date.now() / 1000);
  const since6h  = now - 6  * 3600;
  const since24h = now - 24 * 3600;
  const rows = await db()`
    SELECT
      op_type,
      COUNT(*) FILTER (WHERE timestamp >= ${since6h})  AS cnt_6h,
      COUNT(*) FILTER (WHERE timestamp >= ${since24h}) AS cnt_24h
    FROM transfers
    WHERE to_addr = ${addr}
      AND kind = 'MINT'
      AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL')
      AND timestamp >= ${since24h}
    GROUP BY op_type`;
  return rows;
}

export async function getPlayerVaultPayouts(address, limit = 50) {
  return db()`
    SELECT hash, log_index, timestamp, amount
    FROM vault_payouts WHERE recipient = ${address.toLowerCase()}
    ORDER BY timestamp DESC LIMIT ${limit}`;
}

export async function getPlayerOpsBreakdown(address) {
  const addr = address.toLowerCase();
  const earned = await db()`
    SELECT op_type, COUNT(*) AS cnt, ROUND(SUM(amount)::numeric, 0) AS total
    FROM transfers WHERE kind='MINT' AND to_addr = ${addr}
    GROUP BY op_type ORDER BY total DESC`;
  const spent = await db()`
    SELECT op_type, COUNT(*) AS cnt, ROUND(SUM(amount)::numeric, 0) AS total
    FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr = ${addr}
    GROUP BY op_type ORDER BY total DESC`;
  const [dex_sold] = await db()`
    SELECT COUNT(*) AS cnt, ROUND(SUM(amount)::numeric, 0) AS total
    FROM transfers WHERE kind='TRANSFER' AND from_addr = ${addr}
      AND (op_type='DEX_SELL' OR to_addr = ANY(${DEX_POOLS}))`;
  const [dex_bought] = await db()`
    SELECT COUNT(*) AS cnt, ROUND(SUM(amount)::numeric, 0) AS total
    FROM transfers WHERE kind='TRANSFER' AND to_addr = ${addr}
      AND (op_type='DEX_BUY' OR from_addr = ANY(${DEX_POOLS}))`;
  return {
    earned: earned.map(r => ({ ...r, cnt: Number(r.cnt), total: Number(r.total) })),
    spent:  spent.map(r  => ({ ...r, cnt: Number(r.cnt), total: Number(r.total) })),
    dex_sold:   { cnt: Number(dex_sold?.cnt ?? 0),   total: Number(dex_sold?.total  ?? 0) },
    dex_bought: { cnt: Number(dex_bought?.cnt ?? 0), total: Number(dex_bought?.total ?? 0) },
  };
}

export async function getPlayerInfluenceStats(address) {
  const addr = address.toLowerCase();
  const [r] = await db()`
    SELECT
      CAST(SUM(CASE WHEN kind='MINT' AND EXISTS(
        SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1
      ) THEN amount ELSE 0 END) AS BIGINT) AS total_refunded,
      CAST(SUM(CASE WHEN kind='MINT' AND NOT EXISTS(
        SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1
      ) THEN amount ELSE 0 END) AS BIGINT) AS total_purchased,
      SUM(CASE WHEN kind='MINT' AND NOT EXISTS(
        SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1
      ) THEN 1 ELSE 0 END) AS purchase_count,
      CAST(SUM(CASE WHEN kind='BURN' THEN amount ELSE 0 END) AS BIGINT) AS total_burned
    FROM influence_transfers WHERE to_addr = ${addr} OR from_addr = ${addr}`;
  return {
    totalRefunded:  Number(r?.total_refunded  ?? 0),
    totalPurchased: Number(r?.total_purchased ?? 0),
    purchaseCount:  Number(r?.purchase_count  ?? 0),
    totalBurned:    Number(r?.total_burned    ?? 0),
  };
}

export async function getPlayerDailyHistory(address) {
  const addr = address.toLowerCase();
  return db()`
    SELECT
      TO_CHAR(TO_TIMESTAMP(timestamp::float), 'YYYY-MM-DD') AS day,
      ROUND(SUM(CASE WHEN kind='MINT'              AND to_addr   = ${addr} THEN amount ELSE 0 END)::numeric, 0) AS earned,
      ROUND(SUM(CASE WHEN kind IN ('SPEND','BURN') AND from_addr = ${addr} THEN amount ELSE 0 END)::numeric, 0) AS spent,
      SUM(CASE WHEN kind='MINT' AND to_addr = ${addr} THEN 1 ELSE 0 END) AS ops
    FROM transfers
    WHERE (to_addr = ${addr} OR from_addr = ${addr}) AND kind IN ('MINT','SPEND','BURN')
    GROUP BY day ORDER BY day ASC`;
}

// ─── chart bucket helpers ─────────────────────────────────────────────────────

// Returns Unix timestamps for each bucket slot — labels are formatted client-side in local time.
function bucketTs(startTs, numSlots, unit) {
  return Array.from({ length: numSlots }, (_, i) => startTs + i * unit);
}

export async function getEmissionBuckets(unit) {
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM transfers
    WHERE kind IN ('MINT','SPEND','BURN') AND NOT (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))`;
  if (!first?.ts) return [];
  const startTs  = Math.floor(Number(first.ts) / unit) * unit;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      COUNT(*) AS mints,
      CAST(SUM(amount) AS BIGINT) AS dirty
    FROM transfers WHERE kind='MINT' AND NOT (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), r]));
  const tss  = bucketTs(startTs, numSlots, unit);
  return tss.map((ts, i) => ({
    ts, mints: Number(map.get(i)?.mints ?? 0), dirty: Number(map.get(i)?.dirty ?? 0),
  }));
}

export async function getBurnBuckets(unit) {
  const [first] = await db()`SELECT MIN(timestamp) AS ts FROM transfers WHERE kind IN ('SPEND','BURN')`;
  if (!first?.ts) return [];
  const startTs  = Math.floor(Number(first.ts) / unit) * unit;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      CAST(SUM(CASE WHEN op_type='BURN'             THEN amount ELSE 0 END) AS BIGINT) AS burned,
      CAST(SUM(CASE WHEN op_type='BUY_ASSET'        THEN amount ELSE 0 END) AS BIGINT) AS assets,
      CAST(SUM(CASE WHEN op_type='LEVEL_UP'         THEN amount ELSE 0 END) AS BIGINT) AS levels,
      CAST(SUM(CASE WHEN op_type='THIRD_ENTERPRISE' THEN amount ELSE 0 END) AS BIGINT) AS enterprise
    FROM transfers WHERE kind IN ('SPEND','BURN')
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), r]));
  const tss  = bucketTs(startTs, numSlots, unit);
  return tss.map((ts, i) => {
    const r = map.get(i);
    return {
      ts,
      burned:     Number(r?.burned     ?? 0),
      assets:     Number(r?.assets     ?? 0),
      levels:     Number(r?.levels     ?? 0),
      enterprise: Number(r?.enterprise ?? 0),
    };
  });
}

export async function getFlowBuckets(unit) {
  const [first] = await db()`SELECT MIN(timestamp) AS ts FROM transfers WHERE kind IN ('MINT','SPEND','BURN')`;
  if (!first?.ts) return [];
  const startTs  = Math.floor(Number(first.ts) / unit) * unit;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      CAST(SUM(CASE WHEN kind='MINT'             AND NOT (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS})) THEN amount ELSE 0 END) AS BIGINT) AS minted,
      CAST(SUM(CASE WHEN kind IN ('SPEND','BURN')                                                           THEN amount ELSE 0 END) AS BIGINT) AS spent,
      CAST(SUM(CASE WHEN kind='MINT'             AND     (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS})) THEN amount ELSE 0 END) AS BIGINT) AS protocol_mint
    FROM transfers WHERE kind IN ('MINT','SPEND','BURN')
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), r]));
  const tss  = bucketTs(startTs, numSlots, unit);
  return tss.map((ts, i) => {
    const r    = map.get(i);
    const minted = Number(r?.minted ?? 0), spent = Number(r?.spent ?? 0), protocolMint = Number(r?.protocol_mint ?? 0);
    return { ts, minted, spent, net: minted - spent, protocolMint };
  });
}

export async function getSupplyHistoryForChart(unit) {
  const part = unit === 86400
    ? `DATE(TO_TIMESTAMP(timestamp::float))`
    : `DATE_TRUNC('hour', TO_TIMESTAMP(timestamp::float))`;
  return db().unsafe(`
    SELECT EXTRACT(EPOCH FROM ${part})::bigint AS ts, supply
    FROM (
      SELECT timestamp, supply, ROW_NUMBER() OVER (PARTITION BY ${part} ORDER BY timestamp DESC) AS rn
      FROM supply_snapshots
    ) t WHERE rn = 1 ORDER BY ts ASC
  `);
}

export async function getInfluenceBuckets(unit) {
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM influence_transfers WHERE kind IN ('MINT','BURN') AND timestamp > 0`;
  if (!first?.ts) return [];
  const startTs  = Math.floor(Number(first.ts) / unit) * unit;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      CAST(SUM(CASE WHEN kind='MINT' THEN amount ELSE 0 END) AS BIGINT) AS minted,
      CAST(SUM(CASE WHEN kind='BURN' THEN amount ELSE 0 END) AS BIGINT) AS burned,
      CAST(SUM(CASE WHEN kind='MINT' AND NOT EXISTS(
        SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1
      ) THEN amount ELSE 0 END) AS BIGINT) AS purchased
    FROM influence_transfers WHERE kind IN ('MINT','BURN') AND timestamp > 0
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), r]));
  const tss  = bucketTs(startTs, numSlots, unit);
  return tss.map((ts, i) => ({
    ts,
    minted:    Number(map.get(i)?.minted    ?? 0),
    burned:    Number(map.get(i)?.burned    ?? 0),
    purchased: Number(map.get(i)?.purchased ?? 0),
  }));
}

export async function getParticipantBuckets(unit) {
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT' AND to_addr != ${ZERO_ADDR}`;
  if (!first?.ts) return [];
  const startTs  = Math.floor(Number(first.ts) / unit) * unit;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT slot, COUNT(*) AS new_wallets FROM (
      SELECT CAST((MIN(timestamp) - ${startTs}) / ${unit} AS BIGINT) AS slot
      FROM transfers WHERE kind='MINT' AND to_addr != ${ZERO_ADDR}
      GROUP BY to_addr
    ) t GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), Number(r.new_wallets)]));
  const tss  = bucketTs(startTs, numSlots, unit);
  return tss.map((ts, i) => ({ ts, newWallets: map.get(i) ?? 0 }));
}

export async function getActiveWalletBuckets(unit) {
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT' AND to_addr != ${ZERO_ADDR}`;
  if (!first?.ts) return [];
  const startTs  = Math.floor(Number(first.ts) / unit) * unit;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      COUNT(DISTINCT CASE WHEN kind='MINT' THEN to_addr END) AS active
    FROM transfers
    WHERE kind = 'MINT' AND to_addr != ${ZERO_ADDR}
      AND NOT (kind = 'MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), Number(r.active)]));
  const tss  = bucketTs(startTs, numSlots, unit);
  return tss.map((ts, i) => ({ ts, activeWallets: map.get(i) ?? 0 }));
}

export async function getOpBreakdownBuckets(unit) {
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM transfers
    WHERE kind='MINT' AND NOT (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))`;
  if (!first?.ts) return [];
  const startTs  = Math.floor(Number(first.ts) / unit) * unit;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      SUM(CASE WHEN op_type='EXTORTION' THEN 1 ELSE 0 END) AS extortion,
      SUM(CASE WHEN op_type='ARMS_DEAL' THEN 1 ELSE 0 END) AS arms_deal,
      SUM(CASE WHEN op_type='DRUG_DEAL' THEN 1 ELSE 0 END) AS drug_deal,
      SUM(CASE WHEN op_type='PARTIAL'   THEN 1 ELSE 0 END) AS partial,
      SUM(CASE WHEN op_type='FAIL'      THEN 1 ELSE 0 END) AS fail,
      CAST(SUM(CASE WHEN op_type='EXTORTION' THEN amount ELSE 0 END) AS BIGINT) AS extortion_dirty,
      CAST(SUM(CASE WHEN op_type='ARMS_DEAL' THEN amount ELSE 0 END) AS BIGINT) AS arms_deal_dirty,
      CAST(SUM(CASE WHEN op_type='DRUG_DEAL' THEN amount ELSE 0 END) AS BIGINT) AS drug_deal_dirty,
      CAST(SUM(CASE WHEN op_type='PARTIAL'   THEN amount ELSE 0 END) AS BIGINT) AS partial_dirty
    FROM transfers WHERE kind='MINT'
      AND to_addr != ALL(${PROTOCOL_ADDRS})
      AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL')
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), r]));
  const tss  = bucketTs(startTs, numSlots, unit);
  return tss.map((ts, i) => {
    const r = map.get(i) ?? {};
    return {
      ts,
      extortion: Number(r.extortion ?? 0), armsDeal: Number(r.arms_deal ?? 0),
      drugDeal:  Number(r.drug_deal  ?? 0), partial:  Number(r.partial   ?? 0),
      fail:      Number(r.fail       ?? 0),
      extortionDirty: Number(r.extortion_dirty ?? 0), armsDealDirty: Number(r.arms_deal_dirty ?? 0),
      drugDealDirty:  Number(r.drug_deal_dirty  ?? 0), partialDirty:  Number(r.partial_dirty   ?? 0),
    };
  });
}

export async function getMissionStats() {
  const rows = await db()`
    SELECT
      op_type,
      COUNT(*)                                 AS count,
      COALESCE(CAST(SUM(amount) AS BIGINT), 0) AS total_dirty
    FROM transfers
    WHERE kind = 'MINT'
      AND to_addr != ${ZERO_ADDR}
      AND to_addr != ALL(${PROTOCOL_ADDRS})
      AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL')
    GROUP BY op_type
    ORDER BY count DESC`;
  return rows.map(r => ({
    opType:     r.op_type,
    count:      Number(r.count),
    totalDirty: Number(r.total_dirty),
  }));
}

// ─── emissions bundle (all chart data in parallel) ───────────────────────────

export async function computeEmissions() {
  const [
    dailyBuckets, hourlyBuckets,
    dailyBurnBuckets, hourlyBurnBuckets,
    dailyFlowBuckets, hourlyFlowBuckets,
    dailySupply, hourlySupply,
    dailyInfluence, hourlyInfluence,
    influenceStats,
    dailyParticipants, hourlyParticipants,
    dailyActiveWallets, hourlyActiveWallets,
    dailyOpBreakdown, hourlyOpBreakdown,
    missionStats,
  ] = await Promise.all([
    getEmissionBuckets(86400), getEmissionBuckets(3600),
    getBurnBuckets(86400),     getBurnBuckets(3600),
    getFlowBuckets(86400),     getFlowBuckets(3600),
    getSupplyHistoryForChart(86400), getSupplyHistoryForChart(3600),
    getInfluenceBuckets(86400), getInfluenceBuckets(3600),
    getInfluenceStats(),
    getParticipantBuckets(86400), getParticipantBuckets(3600),
    getActiveWalletBuckets(86400), getActiveWalletBuckets(3600),
    getOpBreakdownBuckets(86400), getOpBreakdownBuckets(3600),
    getMissionStats(),
  ]);
  return {
    dailyBuckets, hourlyBuckets,
    dailyBurnBuckets, hourlyBurnBuckets,
    dailyFlowBuckets, hourlyFlowBuckets,
    dailySupply, hourlySupply,
    dailyInfluence, hourlyInfluence,
    influenceStats,
    dailyParticipants, hourlyParticipants,
    dailyActiveWallets, hourlyActiveWallets,
    dailyOpBreakdown, hourlyOpBreakdown,
    missionStats,
  };
}

// ─── companies ────────────────────────────────────────────────────────────────

export async function getKnownWallets(limit = 1000) {
  const rows = await db()`SELECT address FROM token_holders ORDER BY rank ASC LIMIT ${limit}`;
  return rows.map(r => r.address);
}

export async function upsertCompanies(rows) {
  if (!rows.length) return;
  const now = Math.floor(Date.now() / 1000);
  const values = rows.map(r => ({
    address:      r.company,
    owner:        r.owner,
    active:       !!r.active,
    completable:  !!r.completable,
    liquidatable: !!r.liquidatable,
    end_time:     r.endTime     ?? 0,
    liq_price:    r.liqPrice    ?? '0',
    auto_trade:   !!r.autoTradeEnabled,
    cooldown_end: r.cooldownEnd ?? 0,
    last_updated: now,
  }));
  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db()`INSERT INTO companies ${db()(values.slice(i, i + CHUNK))}
      ON CONFLICT(address) DO UPDATE SET
        owner        = EXCLUDED.owner,
        active       = EXCLUDED.active,
        completable  = EXCLUDED.completable,
        liquidatable = EXCLUDED.liquidatable,
        end_time     = EXCLUDED.end_time,
        liq_price    = EXCLUDED.liq_price,
        auto_trade   = EXCLUDED.auto_trade,
        cooldown_end = EXCLUDED.cooldown_end,
        last_updated = EXCLUDED.last_updated`;
  }
}

// CompanyCreated event topic — emitted by the factory for every company (presale + post-presale).
// topic1 = owner, topic2 = company address.
const COMPANY_CREATED_TOPIC = '0x6a246aa8ae6c3f23b16e88521d3b4a34d69a84eb98f49f9e2149c801758c8693';
const FACTORY_ADDR          = '0x619814a203ca441611cee02abf31986ca265dd35';

export async function getCompanyStats() {
  const [liveStats] = await db()`
    SELECT
      SUM(CASE WHEN active       THEN 1 ELSE 0 END) AS active_count,
      SUM(CASE WHEN auto_trade   THEN 1 ELSE 0 END) AS auto_trade_count,
      SUM(CASE WHEN liquidatable THEN 1 ELSE 0 END) AS liquidatable_count,
      SUM(CASE WHEN completable  THEN 1 ELSE 0 END) AS completable_count
    FROM companies`;

  // Total and unique owners sourced from factory creation events — includes presale companies.
  const [eventStats] = await db()`
    SELECT COUNT(*) AS total, COUNT(DISTINCT topic1) AS unique_owners
    FROM idx_logs
    WHERE address = ${FACTORY_ADDR} AND topic0 = ${COMPANY_CREATED_TOPIC}`;

  return {
    total:            Number(eventStats?.total         ?? 0),
    activeCount:      Number(liveStats?.active_count   ?? 0),
    autoTradeCount:   Number(liveStats?.auto_trade_count ?? 0),
    liquidatableCount:Number(liveStats?.liquidatable_count ?? 0),
    completableCount: Number(liveStats?.completable_count  ?? 0),
    uniqueOwners:     Number(eventStats?.unique_owners ?? 0),
  };
}

export async function getCompanies(filter = 'all', limit = 500) {
  const where = {
    all:         db()`TRUE`,
    active:      db()`active = TRUE`,
    autotrade:   db()`auto_trade = TRUE`,
    liquidatable:db()`liquidatable = TRUE`,
    completable: db()`completable = TRUE`,
  }[filter] ?? db()`TRUE`;
  return db()`
    SELECT address, owner, active, completable, liquidatable,
           end_time, liq_price, auto_trade, cooldown_end, last_updated
    FROM companies
    WHERE ${where}
    ORDER BY auto_trade DESC, active DESC, liquidatable DESC, address ASC
    LIMIT ${limit}`;
}

// ─── enhanced leaderboard (players + company join) ───────────────────────────

export async function getAllPlayerAddresses(limit = 10000) {
  const rows = await db()`
    SELECT DISTINCT to_addr AS address
    FROM transfers
    WHERE kind = 'MINT' AND to_addr != ${ZERO_ADDR}
    LIMIT ${limit}`;
  return rows.map(r => r.address);
}

export async function getEnhancedLeaderboard(limit = 1000, offset = 0) {
  const rows = await db()`
    SELECT
      p.addr,
      p.earned,
      p.ops,
      p.spent,
      p.dex_sold,
      p.dex_bought,
      p.last_active,
      COALESCE(c.num_companies,    0) AS num_companies,
      COALESCE(c.active_companies, 0) AS active_companies,
      COALESCE(c.liq_companies,    0) AS liq_companies,
      COALESCE(c.auto_off_active,  0) AS auto_off_active
    FROM (
      SELECT
        addr,
        SUM(earned)     AS earned,
        SUM(ops)        AS ops,
        SUM(spent)      AS spent,
        SUM(dex_sold)   AS dex_sold,
        SUM(dex_bought) AS dex_bought,
        MAX(ts)         AS last_active
      FROM (
        SELECT to_addr AS addr, amount AS earned, 1 AS ops, 0 AS spent, 0 AS dex_sold, 0 AS dex_bought, timestamp AS ts
          FROM transfers WHERE kind='MINT' AND to_addr != ${ZERO_ADDR}
        UNION ALL
        SELECT from_addr, 0, 0, amount, 0, 0, timestamp
          FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr != ${ZERO_ADDR} AND from_addr != ALL(${DEX_POOLS})
        UNION ALL
        SELECT from_addr, 0, 0, 0, amount, 0, timestamp
          FROM transfers WHERE kind='TRANSFER'
            AND (op_type='DEX_SELL' OR to_addr = ANY(${DEX_POOLS}))
            AND from_addr != ${ZERO_ADDR} AND from_addr != ALL(${DEX_POOLS})
        UNION ALL
        SELECT to_addr, 0, 0, 0, 0, amount, timestamp
          FROM transfers WHERE kind='TRANSFER'
            AND (op_type='DEX_BUY' OR from_addr = ANY(${DEX_POOLS}))
            AND to_addr != ${ZERO_ADDR} AND to_addr != ALL(${DEX_POOLS})
      ) t
      GROUP BY addr
    ) p
    LEFT JOIN (
      SELECT
        owner,
        COUNT(*)                                                    AS num_companies,
        SUM(CASE WHEN active        THEN 1 ELSE 0 END)             AS active_companies,
        SUM(CASE WHEN liquidatable  THEN 1 ELSE 0 END)             AS liq_companies,
        SUM(CASE WHEN NOT auto_trade AND active THEN 1 ELSE 0 END) AS auto_off_active
      FROM companies
      GROUP BY owner
    ) c ON c.owner = p.addr
    ORDER BY p.earned DESC
    LIMIT ${limit} OFFSET ${offset}`;
  return rows.map(r => ({
    addr:            r.addr,
    earned:          Number(r.earned          ?? 0),
    ops:             Number(r.ops             ?? 0),
    spent:           Number(r.spent           ?? 0),
    dex_sold:        Number(r.dex_sold        ?? 0),
    dex_bought:      Number(r.dex_bought      ?? 0),
    last_active:     r.last_active            ?? null,
    num_companies:   Number(r.num_companies   ?? 0),
    active_companies:Number(r.active_companies ?? 0),
    liq_companies:   Number(r.liq_companies   ?? 0),
    auto_off_active: Number(r.auto_off_active  ?? 0),
  }));
}

// ─── economy buckets ─────────────────────────────────────────────────────────

// Returns rows from economy_buckets for the given unit (3600 or 86400).
// Also appends a fresh in-progress bucket for the current partial period.
export async function getEconomyBuckets(unit = 3600) {
  const PROTOCOL_ADDRS = ['0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462'];
  const rows = await db()`
    SELECT ts, unit, inf_purchased, dirty_minted, dirty_burned, price_dirty_usdm
    FROM economy_buckets
    WHERE unit = ${unit}
    ORDER BY ts ASC`;

  // Append the current in-progress bucket using the latest stored price
  const nowBucket = Math.floor(Date.now() / 1000 / unit) * unit;
  const [liveInf] = await db()`
    SELECT COALESCE(SUM(amount), 0)::float AS v
    FROM influence_transfers
    WHERE kind = 'MINT' AND timestamp >= ${nowBucket}
      AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.hash = influence_transfers.hash LIMIT 1)`;
  const [liveDirty] = await db()`
    SELECT
      COALESCE(SUM(CASE WHEN kind = 'MINT'            THEN amount ELSE 0 END), 0)::float AS minted,
      COALESCE(SUM(CASE WHEN kind IN ('BURN','SPEND') THEN amount ELSE 0 END), 0)::float AS burned
    FROM transfers
    WHERE timestamp >= ${nowBucket}
      AND kind IN ('MINT','BURN','SPEND')
      AND to_addr != '0x0000000000000000000000000000000000000000'
      AND NOT (kind = 'MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))`;
  const [latestPrice] = await db()`
    SELECT price_usdm_per_dirty::float AS price FROM v_dex_swaps ORDER BY ts DESC LIMIT 1`;

  const livePrice = Number(latestPrice?.price ?? 0);
  const liveMinted = Number(liveDirty?.minted ?? 0);
  const liveBurned = Number(liveDirty?.burned ?? 0);

  const live = {
    ts:               nowBucket,
    unit,
    inf_purchased:    Number(liveInf?.v ?? 0),
    dirty_minted:     liveMinted,
    dirty_burned:     liveBurned,
    price_dirty_usdm: livePrice,
    // USD computed fields
    inf_usdm:         Number(liveInf?.v ?? 0),
    dirty_minted_usdm: liveMinted * livePrice,
    dirty_burned_usdm: liveBurned * livePrice,
    dirty_net_usdm:    (liveMinted - liveBurned) * livePrice,
    live:              true,
  };

  const mapped = rows.map(r => {
    const price = Number(r.price_dirty_usdm);
    const minted = Number(r.dirty_minted);
    const burned = Number(r.dirty_burned);
    const inf = Number(r.inf_purchased);
    return {
      ts:                Number(r.ts),
      unit:              r.unit,
      inf_purchased:     inf,
      dirty_minted:      minted,
      dirty_burned:      burned,
      price_dirty_usdm:  price,
      // USD values — INF is 1:1 with USDm
      inf_usdm:          inf,
      dirty_minted_usdm: minted * price,
      dirty_burned_usdm: burned * price,
      dirty_net_usdm:    (minted - burned) * price,
    };
  });

  if (mapped.length && mapped[mapped.length - 1].ts === nowBucket) {
    mapped[mapped.length - 1] = live;
  } else {
    mapped.push(live);
  }
  return mapped;
}

// ─── reconcile ────────────────────────────────────────────────────────────────

export let reconcileStatus = { running: false, done: 0, total: 0, added: 0, error: null };
