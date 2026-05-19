import { getDb, ZERO_ADDR, DEX_POOLS } from './connection.js';
const db = () => getDb();

export async function getKnownWallets(limit = 1000) {
  const rows = await db()`SELECT address FROM token_holders ORDER BY rank ASC LIMIT ${limit}`;
  return rows.map(r => r.address);
}

// Map<companyAddrLower, ownerAddrLower> for the given list. Missing rows are simply absent.
export async function getCompanyOwners(addrs) {
  if (!addrs || addrs.length === 0) return new Map();
  const rows = await db()`SELECT address, owner FROM companies WHERE address = ANY(${addrs})`.catch(() => []);
  const out = new Map();
  for (const r of rows) out.set(r.address.toLowerCase(), r.owner.toLowerCase());
  return out;
}

// Map<companyAddrLower, 'DRUG_DEAL' | 'ARMS_DEAL' | 'EXTORTION'> for the given list,
// reading the cached `trade_type` column populated by syncCompanies. Used as a
// fallback for transfers.js / partial-sweep when the on-chain storage read at
// blockNum-1 fails (RPC rate-limit, missing block, etc.).
export async function getCompanyTradeTypesFromDb(addrs) {
  if (!addrs || addrs.length === 0) return new Map();
  const lower = addrs.map(a => a.toLowerCase());
  const rows = await db()`
    SELECT address, trade_type
    FROM companies
    WHERE address = ANY(${lower}) AND trade_type IS NOT NULL`.catch(() => []);
  const out = new Map();
  for (const r of rows) out.set(r.address.toLowerCase(), r.trade_type);
  return out;
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
    trade_type:   r.tradeType   ?? null,
  }));
  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db()`INSERT INTO companies ${db()(values.slice(i, i + CHUNK))}
      ON CONFLICT(address) DO UPDATE SET
        owner         = EXCLUDED.owner,
        active        = EXCLUDED.active,
        completable   = EXCLUDED.completable,
        liquidatable  = EXCLUDED.liquidatable,
        end_time      = EXCLUDED.end_time,
        liq_price     = EXCLUDED.liq_price,
        auto_trade    = EXCLUDED.auto_trade,
        cooldown_end  = EXCLUDED.cooldown_end,
        last_updated  = EXCLUDED.last_updated,
        trade_type    = COALESCE(EXCLUDED.trade_type, companies.trade_type),
        deactivated_at = CASE
          WHEN companies.active = TRUE AND EXCLUDED.active = FALSE THEN EXCLUDED.last_updated
          ELSE companies.deactivated_at
        END`;
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

export async function getCompanies(filter = 'all', limit = null) {
  const where = {
    all:         db()`TRUE`,
    active:      db()`active = TRUE`,
    autotrade:   db()`auto_trade = TRUE`,
    liquidatable:db()`liquidatable = TRUE`,
    completable: db()`completable = TRUE`,
  }[filter] ?? db()`TRUE`;
  const order = filter === 'active'
    ? db()`end_time ASC NULLS LAST, address ASC`
    : db()`auto_trade DESC, active DESC, liquidatable DESC, address ASC`;
  const limitClause = limit != null ? db()`LIMIT ${limit}` : db()``;
  return db()`
    SELECT c.address, c.owner, c.active, c.completable, c.liquidatable,
           c.end_time, c.liq_price, c.auto_trade, c.cooldown_end, c.last_updated,
           c.trade_type AS op_type
    FROM companies c
    WHERE ${where}
    ORDER BY ${order}
    ${limitClause}`;
}

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
