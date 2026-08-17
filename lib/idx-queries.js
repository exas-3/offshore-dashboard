// Queries on top of idx_logs / idx_contracts — the raw event index.
// Views (v_dex_swaps, v_company_trades, etc.) are created by offshore-indexer/src/db.js setup().
import { getDb } from './db.js';
import { nowCap } from './demo-clock.js';

function db() { return getDb(); }

const GENESIS_TS = 1762797011;
// asOf → block-number upper bound (MegaETH: timestamp = block + GENESIS).
function capBlockOf(asOf) {
  return asOf == null ? 9007199254740991 : asOf - GENESIS_TS;
}

// Decode signed int256 hex (64 hex chars, no 0x prefix) → float with 1e18 scaling.
export function decodeInt256Wei(hex64) {
  const val = BigInt('0x' + hex64);
  const neg = val >> 255n;
  const abs = neg ? ((1n << 256n) - val) : val;
  return Number(neg ? -abs : abs) / 1e18;
}

// ─── DEX price history (custom AMM main pool) ─────────────────────────────────

// Returns bucketed DIRTY price history from v_dex_swaps.
// These are all "sell DIRTY" events — price = usdm_net / dirty_sold.
export async function getDexPriceHistory(hours = 24, unit = 3600, asOf = null) {
  const { now } = nowCap(asOf);
  const since = now - hours * 3600;
  const rows = await db()`
    SELECT
      (FLOOR(ts::FLOAT / ${unit}) * ${unit})::BIGINT  AS ts,
      AVG(price_usdm_per_dirty)::FLOAT                AS price,
      SUM(dirty_sold)::FLOAT                          AS volume_dirty,
      SUM(usdm_net)::FLOAT                            AS volume_usdm,
      COUNT(*)                                        AS trades
    FROM v_dex_swaps
    WHERE ts >= ${since} AND ts <= ${now} AND price_usdm_per_dirty IS NOT NULL
    GROUP BY 1 ORDER BY 1 ASC`;
  return rows.map(r => ({
    ts:          Number(r.ts),
    price:       Number(r.price        ?? 0),
    volumeDirty: Number(r.volume_dirty ?? 0),
    volumeUsdm:  Number(r.volume_usdm  ?? 0),
    trades:      Number(r.trades),
  }));
}

// Recent individual swaps from the main pool.
export async function getDexRecentSwaps(limit = 50, asOf = null) {
  const { cap } = nowCap(asOf);
  const rows = await db()`
    SELECT ts, tx_hash, recipient,
           dirty_sold, usdm_gross, usdm_fee, usdm_net, price_usdm_per_dirty
    FROM v_dex_swaps WHERE ts <= ${cap} ORDER BY block_num DESC LIMIT ${limit}`;
  return rows.map(r => ({
    ts:              Number(r.ts),
    hash:            r.tx_hash,
    recipient:       r.recipient,
    dirtySold:       Number(r.dirty_sold),
    usdmNet:         Number(r.usdm_net),
    usdmFee:         Number(r.usdm_fee),
    price:           Number(r.price_usdm_per_dirty ?? 0),
  }));
}

// ─── V3 legacy pool swaps ─────────────────────────────────────────────────────

export async function getV3RecentSwaps(limit = 50) {
  const rows = await db()`
    SELECT ts, tx_hash, sender, recipient, amount0_hex, amount1_hex
    FROM v_v3_swaps ORDER BY block_num DESC LIMIT ${limit}`;
  return rows.map(r => ({
    ts:      Number(r.ts),
    hash:    r.tx_hash,
    sender:  r.sender,
    recipient: r.recipient,
    amount0: decodeInt256Wei(r.amount0_hex),
    amount1: decodeInt256Wei(r.amount1_hex),
  }));
}

// ─── Vault cycles from idx ────────────────────────────────────────────────────

export async function getIdxVaultCycles(limit = 100, asOf = null) {
  const { cap } = nowCap(asOf);
  const rows = await db()`
    SELECT ts, tx_hash, distributed, cumulative_total
    FROM v_vault_cycles WHERE ts <= ${cap} ORDER BY block_num DESC LIMIT ${limit}`;
  return rows.map(r => ({
    ts:             Number(r.ts),
    hash:           r.tx_hash,
    distributed:    Number(r.distributed),
    cumulativeTotal:Number(r.cumulative_total),
  }));
}

// ─── Company trades from idx ──────────────────────────────────────────────────

// All trades for a player (owner address), most recent first.
export async function getIdxPlayerTrades(owner, limit = 200, asOf = null) {
  const addr = owner.toLowerCase();
  const { cap } = nowCap(asOf);
  const rows = await db()`
    SELECT ts, tx_hash, company, reward, mode, op_type, source
    FROM v_company_trades
    WHERE owner = ${addr} AND ts <= ${cap}
    ORDER BY block_num DESC, log_index DESC
    LIMIT ${limit}`;
  return rows.map(r => ({
    ts:      Number(r.ts),
    hash:    r.tx_hash,
    company: r.company,
    reward:  Number(r.reward),
    mode:    Number(r.mode),
    opType:  r.op_type,
    source:  r.source,
  }));
}

// Aggregate trade stats for a player.
export async function getIdxPlayerTradeStats(owner) {
  const addr = owner.toLowerCase();
  const [r] = await db()`
    SELECT
      COUNT(*)                                        AS total,
      SUM(CASE WHEN op_type='DRUG_DEAL'  THEN 1 ELSE 0 END) AS drug_deals,
      SUM(CASE WHEN op_type='ARMS_DEAL'  THEN 1 ELSE 0 END) AS arms_deals,
      SUM(CASE WHEN op_type='EXTORTION'  THEN 1 ELSE 0 END) AS extortions,
      SUM(CASE WHEN op_type='FAIL'       THEN 1 ELSE 0 END) AS fails,
      SUM(reward)::FLOAT                              AS total_reward
    FROM v_company_trades
    WHERE owner = ${addr}`;
  if (!r) return null;
  return {
    total:       Number(r.total),
    drugDeals:   Number(r.drug_deals),
    armsDeals:   Number(r.arms_deals),
    extortions:  Number(r.extortions),
    fails:       Number(r.fails),
    totalReward: Number(r.total_reward ?? 0),
  };
}

// ─── Player companies from idx_contracts ──────────────────────────────────────

export async function getIdxPlayerCompanies(owner) {
  const addr = owner.toLowerCase();
  const rows = await db()`
    SELECT address, first_block, indexed_to,
           (1762797011 + first_block) AS created_ts
    FROM idx_contracts
    WHERE owner = ${addr} AND type = 'company'
    ORDER BY first_block ASC`;
  return rows.map(r => ({
    address:   r.address,
    createdTs: Number(r.created_ts),
    firstBlock:Number(r.first_block),
  }));
}

// ─── Factory stats ────────────────────────────────────────────────────────────

export async function getIdxFactoryStats(asOf = null) {
  const capBlock = capBlockOf(asOf);
  const [companies] = await db()`
    SELECT COUNT(*) AS cnt FROM idx_contracts WHERE type = 'company' AND first_block <= ${capBlock}`;
  const [levelUps] = await db()`
    SELECT COUNT(*) AS cnt FROM idx_logs
    WHERE address = '0x619814a203ca441611cee02abf31986ca265dd35'
      AND topic0  = '0x2ca3c57c4517cd4f224f85fc4cb74ad719dfec5650f8dc7cf193c6d6207e8de9'
      AND block_num <= ${capBlock}`;
  const [sold] = await db()`
    SELECT COUNT(*) AS cnt FROM idx_logs
    WHERE address = '0x619814a203ca441611cee02abf31986ca265dd35'
      AND topic0  = '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff'
      AND block_num <= ${capBlock}`;
  return {
    totalCompanies: Number(companies?.cnt ?? 0),
    levelUps:       Number(levelUps?.cnt  ?? 0),
    companiesSold:  Number(sold?.cnt       ?? 0),
  };
}

// Company creation timeline — one row per bucket slot.
export async function getCompanyCreationHistory(unit = 86400, asOf = null) {
  const { now } = nowCap(asOf);
  const capBlock = capBlockOf(asOf);
  const [first] = await db()`
    SELECT MIN(first_block) AS b FROM idx_contracts WHERE type = 'company' AND first_block <= ${capBlock}`;
  if (!first?.b) return [];
  const startTs  = Math.floor((1762797011 + Number(first.b)) / unit) * unit;
  const numSlots = Math.max(1, Math.floor((now - startTs) / unit) + 1);
  const rows = await db()`
    SELECT
      (FLOOR((1762797011 + first_block)::FLOAT / ${unit}) * ${unit})::BIGINT AS ts,
      COUNT(*) AS new_companies
    FROM idx_contracts
    WHERE type = 'company' AND first_block <= ${capBlock}
    GROUP BY 1 ORDER BY 1 ASC`;
  const map = new Map(rows.map(r => [Number(r.ts), Number(r.new_companies)]));
  return Array.from({ length: numSlots }, (_, i) => {
    const ts = startTs + i * unit;
    return { ts, newCompanies: map.get(ts) ?? 0 };
  });
}

// ─── Dirty farmers leaderboard ────────────────────────────────────────────────

const DIRTY_ADDR   = '0xc2f34f8849a8607fd73e06d6849bda07c2b7de38';
const INF_ADDR     = '0x403de0893f0bc66139592ba2fd254672f2db933a';
const TRANSFER_T0  = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC   = '0x0000000000000000000000000000000000000000000000000000000000000000';
const DEPLOYER     = '0x0000000000000000000000005dc36d6dcd5a3792b3980de1f40c7c0970af3462';

// Returns top farmers sorted by dirty_farmed DESC, enriched with player stats.
export async function getDirtyFarmers(limit = 100, asOf = null) {
  const { cap } = nowCap(asOf);
  const capBlock = capBlockOf(asOf);
  const rows = await db()`
    WITH dirty_minted AS (
      SELECT '0x' || right(topic2, 40) AS addr,
             COUNT(*) AS mint_ops,
             SUM(hex_word(data, 0) / 1e18) AS dirty_farmed
      FROM idx_logs
      WHERE address   = ${DIRTY_ADDR}
        AND topic0    = ${TRANSFER_T0}
        AND topic1    = ${ZERO_TOPIC}
        AND topic2   != ${DEPLOYER}
        AND block_num <= ${capBlock}
      GROUP BY topic2
    ),
    inf_burned AS (
      SELECT '0x' || right(topic1, 40) AS addr,
             COUNT(*) AS burn_ops,
             SUM(hex_word(data, 0) / 1e18) AS inf_consumed
      FROM idx_logs
      WHERE address = ${INF_ADDR}
        AND topic0  = ${TRANSFER_T0}
        AND topic2  = ${ZERO_TOPIC}
        AND block_num <= ${capBlock}
      GROUP BY topic1
    ),
    player_stats AS (
      SELECT addr,
             SUM(earned)       AS earned,
             SUM(ops)          AS ops,
             SUM(success_ops)  AS success_ops,
             SUM(mission_ops)  AS mission_ops,
             SUM(spent)        AS spent,
             SUM(dex_sold)     AS dex_sold,
             SUM(dex_bought)   AS dex_bought
      FROM (
        SELECT to_addr   AS addr, amount AS earned, 1 AS ops,
               CASE WHEN op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION') THEN 1 ELSE 0 END AS success_ops,
               CASE WHEN op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL') THEN 1 ELSE 0 END AS mission_ops,
               0.0 AS spent, 0.0 AS dex_sold, 0.0 AS dex_bought
          FROM transfers WHERE kind = 'MINT' AND timestamp <= ${cap}
        UNION ALL
        SELECT from_addr, 0.0, 0, 0, 0, amount, 0.0, 0.0
          FROM transfers WHERE kind IN ('SPEND', 'BURN') AND timestamp <= ${cap}
        UNION ALL
        SELECT from_addr, 0.0, 0, 0, 0, 0.0, amount, 0.0
          FROM transfers WHERE op_type = 'DEX_SELL' AND timestamp <= ${cap}
        UNION ALL
        SELECT to_addr,   0.0, 0, 0, 0, 0.0, 0.0, amount
          FROM transfers WHERE op_type = 'DEX_BUY' AND timestamp <= ${cap}
      ) x
      WHERE addr != '0x0000000000000000000000000000000000000000'
      GROUP BY addr
    )
    SELECT d.addr,
           d.mint_ops,
           ROUND(d.dirty_farmed::numeric, 2)           AS dirty_farmed,
           COALESCE(i.burn_ops, 0)                     AS burn_ops,
           ROUND(COALESCE(i.inf_consumed, 0)::numeric, 2) AS inf_consumed,
           ROUND(COALESCE(p.earned,     0)::numeric, 2) AS earned,
           COALESCE(p.ops, 0)                           AS total_ops,
           COALESCE(p.success_ops, 0)                   AS success_ops,
           COALESCE(p.mission_ops, 0)                   AS mission_ops,
           ROUND(COALESCE(p.spent,      0)::numeric, 2) AS spent,
           ROUND(COALESCE(p.dex_sold,   0)::numeric, 2) AS dex_sold,
           ROUND(COALESCE(p.dex_bought, 0)::numeric, 2) AS dex_bought
    FROM dirty_minted d
    LEFT JOIN inf_burned   i ON i.addr = d.addr
    LEFT JOIN player_stats p ON p.addr = d.addr
    ORDER BY dirty_farmed DESC
    LIMIT ${limit}`;
  return rows.map(r => ({
    addr:        r.addr,
    mintOps:     Number(r.mint_ops),
    dirtyFarmed: Number(r.dirty_farmed),
    burnOps:     Number(r.burn_ops),
    infConsumed: Number(r.inf_consumed),
    earned:      Number(r.earned),
    totalOps:    Number(r.total_ops),
    successOps:  Number(r.success_ops),
    missionOps:  Number(r.mission_ops),
    spent:       Number(r.spent),
    dexSold:     Number(r.dex_sold),
    dexBought:   Number(r.dex_bought),
  }));
}

// ─── DIRTY market cap history (hourly, since first DEX trade) ─────────────────

// Returns one row per hour: ts, price (USDm/DIRTY), supply, marketCap (USDm).
// price = last swap price in that hour; supply = last snapshot in that hour.
export async function getDirtyMarketCapHistory(asOf = null) {
  const { cap } = nowCap(asOf);
  const rows = await db()`
    WITH
    last_price_per_hour AS (
      SELECT DISTINCT ON (date_trunc('hour', to_timestamp(ts)))
        date_trunc('hour', to_timestamp(ts)) AS h,
        price_usdm_per_dirty                 AS price
      FROM v_dex_swaps
      WHERE ts <= ${cap}
      ORDER BY date_trunc('hour', to_timestamp(ts)), ts DESC
    ),
    last_supply_per_hour AS (
      SELECT DISTINCT ON (date_trunc('hour', to_timestamp(timestamp)))
        date_trunc('hour', to_timestamp(timestamp)) AS h,
        supply
      FROM supply_snapshots
      WHERE timestamp <= ${cap}
      ORDER BY date_trunc('hour', to_timestamp(timestamp)), timestamp DESC
    ),
    hours AS (
      SELECT generate_series(
        (SELECT MIN(h) FROM last_price_per_hour),
        (SELECT MAX(h) FROM last_price_per_hour),
        interval '1 hour'
      ) AS h
    )
    SELECT
      extract(epoch FROM h.h)::bigint AS ts,
      p.price,
      s.supply,
      p.price * s.supply AS market_cap
    FROM hours h
    LEFT JOIN last_price_per_hour  p ON p.h = h.h
    LEFT JOIN last_supply_per_hour s ON s.h = h.h
    WHERE p.price IS NOT NULL AND s.supply IS NOT NULL
    ORDER BY h.h`;
  return rows.map(r => ({
    ts:        Number(r.ts),
    price:     Number(r.price),
    supply:    Number(r.supply),
    marketCap: Number(r.market_cap),
  }));
}
