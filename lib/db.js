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
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
  }
  return _sql;
}

// Lazily-initialised — call getDb() inside every function so the module
// can be imported during build without a live database.
function db() {
  return getDb();
}

const ZERO_ADDR     = '0x0000000000000000000000000000000000000000';
const PROTOCOL_ADDRS = ['0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462'];
const LP            = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';

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

// ─── transfers ────────────────────────────────────────────────────────────────

export async function upsertTransfers(rows) {
  if (!rows.length) return;
  const values = rows.map(r => ({
    hash: r.hash, log_index: r.logIndex ?? 0, block_num: r.blockNum,
    timestamp: r.timestamp, from_addr: r.fromAddr, to_addr: r.toAddr,
    raw_value: r.rawValue ?? String(r.amount), amount: r.amount,
    kind: r.kind, op_type: r.opType ?? '',
  }));
  await db()`INSERT INTO transfers ${db()(values)}
    ON CONFLICT(hash, log_index) DO NOTHING`;
}

export async function getRecentTransfers(limit = 100, offset = 0) {
  return db()`SELECT hash, log_index, timestamp, from_addr, to_addr, amount, kind, op_type
    FROM transfers ORDER BY timestamp DESC, log_index DESC LIMIT ${limit} OFFSET ${offset}`;
}

export async function getTotalTransferCount() {
  const [row] = await db()`SELECT COUNT(*) AS cnt FROM transfers`;
  return Number(row?.cnt ?? 0);
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
    WHERE kind = 'TRANSFER' AND (from_addr = ${LP} OR to_addr = ${LP})
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
      CASE WHEN to_addr = ${LP} THEN from_addr ELSE to_addr END AS addr,
      SUM(CASE WHEN to_addr   = ${LP} THEN amount ELSE 0 END) AS sold,
      SUM(CASE WHEN from_addr = ${LP} THEN amount ELSE 0 END) AS bought
    FROM transfers
    WHERE kind = 'TRANSFER' AND (from_addr = ${LP} OR to_addr = ${LP})
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
  await db()`INSERT INTO influence_transfers ${db()(values)}
    ON CONFLICT(hash, log_index) DO NOTHING`;
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
  await db()`INSERT INTO vault_payouts ${db()(values)}
    ON CONFLICT(hash, log_index) DO NOTHING`;
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

export async function getVaultCycleHistory(limit = 50) {
  const rows = await db()`
    SELECT
      CAST(FLOOR(timestamp / (8*3600)) * (8*3600) AS BIGINT) AS cycle_start,
      COUNT(*) AS payouts,
      CAST(SUM(amount) AS DOUBLE PRECISION) AS total,
      CAST(MAX(amount) AS DOUBLE PRECISION) AS top
    FROM vault_payouts
    GROUP BY cycle_start ORDER BY cycle_start DESC LIMIT ${limit}`;
  return rows;
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
        FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr NOT IN (${ZERO_ADDR}, ${LP})
      UNION ALL
      SELECT from_addr, 0, 0, 0, amount, 0, timestamp
        FROM transfers WHERE kind='TRANSFER' AND to_addr = ${LP} AND from_addr NOT IN (${ZERO_ADDR}, ${LP})
      UNION ALL
      SELECT to_addr,   0, 0, 0, 0, amount, timestamp
        FROM transfers WHERE kind='TRANSFER' AND from_addr = ${LP} AND to_addr NOT IN (${ZERO_ADDR}, ${LP})
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
        FROM transfers WHERE kind='TRANSFER' AND to_addr = ${LP} AND from_addr = ${addr}
      UNION ALL
      SELECT 0, 0, 0, 0, amount, timestamp
        FROM transfers WHERE kind='TRANSFER' AND from_addr = ${LP} AND to_addr = ${addr}
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
    FROM transfers WHERE kind='TRANSFER' AND from_addr = ${addr} AND to_addr = ${LP}`;
  const [dex_bought] = await db()`
    SELECT COUNT(*) AS cnt, ROUND(SUM(amount)::numeric, 0) AS total
    FROM transfers WHERE kind='TRANSFER' AND to_addr = ${addr} AND from_addr = ${LP}`;
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

function bucketLabels(startTs, numSlots, unit) {
  return Array.from({ length: numSlots }, (_, i) => {
    const ts = new Date((startTs + i * unit) * 1000);
    return unit === 3600
      ? `${ts.getUTCMonth() + 1}/${ts.getUTCDate()} ${String(ts.getUTCHours()).padStart(2, '0')}h`
      : `${ts.getUTCMonth() + 1}/${ts.getUTCDate()}`;
  });
}

export async function getEmissionBuckets(unit) {
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM transfers
    WHERE kind IN ('MINT','SPEND','BURN') AND NOT (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))`;
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : Number(first.ts);
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      COUNT(*) AS mints,
      CAST(SUM(amount) AS BIGINT) AS dirty
    FROM transfers WHERE kind='MINT' AND NOT (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), r]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => ({
    label, mints: Number(map.get(i)?.mints ?? 0), dirty: Number(map.get(i)?.dirty ?? 0),
  }));
}

export async function getBurnBuckets(unit) {
  const [first] = await db()`SELECT MIN(timestamp) AS ts FROM transfers WHERE kind IN ('SPEND','BURN')`;
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : Number(first.ts);
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
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => {
    const r = map.get(i);
    return {
      label,
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
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : Number(first.ts);
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      CAST(SUM(CASE WHEN kind='MINT'             AND NOT (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS})) THEN amount ELSE 0 END) AS BIGINT) AS minted,
      CAST(SUM(CASE WHEN kind IN ('SPEND','BURN')                                                           THEN amount ELSE 0 END) AS BIGINT) AS spent,
      CAST(SUM(CASE WHEN kind='MINT'             AND     (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS})) THEN amount ELSE 0 END) AS BIGINT) AS protocol_mint
    FROM transfers WHERE kind IN ('MINT','SPEND','BURN')
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), r]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => {
    const r    = map.get(i);
    const minted = Number(r?.minted ?? 0), spent = Number(r?.spent ?? 0), protocolMint = Number(r?.protocol_mint ?? 0);
    return { label, minted, spent, net: minted - spent, protocolMint };
  });
}

export async function getSupplyHistoryForChart(unit) {
  const part = unit === 86400
    ? `DATE(TO_TIMESTAMP(timestamp::float))`
    : `DATE_TRUNC('hour', TO_TIMESTAMP(timestamp::float))`;
  const labelFmt = unit === 86400
    ? `CAST(EXTRACT(MONTH FROM TO_TIMESTAMP(timestamp::float)) AS INTEGER)::text || '/' || CAST(EXTRACT(DAY FROM TO_TIMESTAMP(timestamp::float)) AS INTEGER)::text`
    : `TO_CHAR(TO_TIMESTAMP(timestamp::float), 'FMMM/FMDD ') || LPAD(CAST(EXTRACT(HOUR FROM TO_TIMESTAMP(timestamp::float)) AS INTEGER)::text,2,'0') || 'h'`;
  return db().unsafe(`
    SELECT ${labelFmt} AS label, supply
    FROM (
      SELECT timestamp, supply, ROW_NUMBER() OVER (PARTITION BY ${part} ORDER BY timestamp DESC) AS rn
      FROM supply_snapshots
    ) t WHERE rn = 1 ORDER BY timestamp ASC
  `);
}

export async function getInfluenceBuckets(unit) {
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM influence_transfers WHERE kind IN ('MINT','BURN') AND timestamp > 0`;
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : Number(first.ts);
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
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => ({
    label,
    minted:    Number(map.get(i)?.minted    ?? 0),
    burned:    Number(map.get(i)?.burned    ?? 0),
    purchased: Number(map.get(i)?.purchased ?? 0),
  }));
}

export async function getParticipantBuckets(unit) {
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT' AND to_addr != ${ZERO_ADDR}`;
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : Number(first.ts);
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT slot, COUNT(*) AS new_wallets FROM (
      SELECT CAST((MIN(timestamp) - ${startTs}) / ${unit} AS BIGINT) AS slot
      FROM transfers WHERE kind='MINT' AND to_addr != ${ZERO_ADDR}
      GROUP BY to_addr
    ) t GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), Number(r.new_wallets)]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => ({ label, newWallets: map.get(i) ?? 0 }));
}

export async function getActiveWalletBuckets(unit) {
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT' AND to_addr != ${ZERO_ADDR}`;
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : Number(first.ts);
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      COUNT(DISTINCT CASE WHEN kind='MINT' THEN to_addr END) AS active
    FROM transfers
    WHERE kind = 'MINT' AND to_addr != ${ZERO_ADDR}
      AND NOT (kind = 'MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), Number(r.active)]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => ({ label, activeWallets: map.get(i) ?? 0 }));
}

export async function getOpBreakdownBuckets(unit) {
  const [first] = await db()`
    SELECT MIN(timestamp) AS ts FROM transfers
    WHERE kind='MINT' AND NOT (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))`;
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : Number(first.ts);
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = await db()`
    SELECT CAST((timestamp - ${startTs}) / ${unit} AS BIGINT) AS slot,
      SUM(CASE WHEN op_type='EXTORTION' THEN 1 ELSE 0 END) AS extortion,
      SUM(CASE WHEN op_type='ARMS_DEAL' THEN 1 ELSE 0 END) AS arms_deal,
      SUM(CASE WHEN op_type='DRUG_DEAL' THEN 1 ELSE 0 END) AS drug_deal,
      SUM(CASE WHEN op_type='PARTIAL'   THEN 1 ELSE 0 END) AS partial,
      CAST(SUM(CASE WHEN op_type='EXTORTION' THEN amount ELSE 0 END) AS BIGINT) AS extortion_dirty,
      CAST(SUM(CASE WHEN op_type='ARMS_DEAL' THEN amount ELSE 0 END) AS BIGINT) AS arms_deal_dirty,
      CAST(SUM(CASE WHEN op_type='DRUG_DEAL' THEN amount ELSE 0 END) AS BIGINT) AS drug_deal_dirty,
      CAST(SUM(CASE WHEN op_type='PARTIAL'   THEN amount ELSE 0 END) AS BIGINT) AS partial_dirty
    FROM transfers WHERE kind='MINT' AND NOT (kind='MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))
    GROUP BY slot ORDER BY slot ASC`;
  const map = new Map(rows.map(r => [Number(r.slot), r]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => {
    const r = map.get(i) ?? {};
    return {
      label,
      extortion: Number(r.extortion ?? 0), armsDeal: Number(r.arms_deal ?? 0),
      drugDeal:  Number(r.drug_deal  ?? 0), partial:  Number(r.partial   ?? 0),
      extortionDirty: Number(r.extortion_dirty ?? 0), armsDealDirty: Number(r.arms_deal_dirty ?? 0),
      drugDealDirty:  Number(r.drug_deal_dirty  ?? 0), partialDirty:  Number(r.partial_dirty   ?? 0),
    };
  });
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
  };
}

// ─── reconcile ────────────────────────────────────────────────────────────────

export let reconcileStatus = { running: false, done: 0, total: 0, added: 0, error: null };
