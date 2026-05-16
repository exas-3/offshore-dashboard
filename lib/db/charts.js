import { getDb, ZERO_ADDR, PROTOCOL_ADDRS } from './connection.js';
import { getInfluenceStats, getInfluenceBuckets } from './influence.js';
const db = () => getDb();

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

// Returns rows from economy_buckets for the given unit (3600 or 86400).
// Also appends a fresh in-progress bucket for the current partial period.
export async function getEconomyBuckets(unit = 3600) {
  const rows = await db()`
    SELECT ts, unit, inf_purchased, dirty_minted, dirty_burned, price_dirty_usdm
    FROM economy_buckets
    WHERE unit = ${unit}
    ORDER BY ts ASC`;

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
