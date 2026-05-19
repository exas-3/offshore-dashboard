import { getDb, ZERO_ADDR, DEX_POOLS } from './connection.js';
const db = () => getDb();

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

export async function getPlayerStats(address, cycleStart = 0) {
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
  // Hits this cycle (Season 2: 24h since 09:30 UTC).
  // Daily cap of 10 applies only to hits *received* (the victim side).
  // Hits *made* is uncapped — split into W (profitable) and L (loss) so
  // the indexed-stats panel can show a quick W/L summary.
  const [hitsCycle] = await db()`
    SELECT
      COUNT(*) FILTER (WHERE attacker = ${addr})::int                          AS made,
      COUNT(*) FILTER (WHERE attacker = ${addr} AND stolen >  cost)::int       AS made_won,
      COUNT(*) FILTER (WHERE attacker = ${addr} AND stolen <= cost)::int       AS made_lost,
      COUNT(*) FILTER (WHERE victim   = ${addr})::int                          AS received
    FROM hits
    WHERE timestamp >= ${cycleStart}
      AND (attacker = ${addr} OR victim = ${addr})`;
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
    hits_made_cycle:     Number(hitsCycle?.made     ?? 0),
    hits_made_won:       Number(hitsCycle?.made_won ?? 0),
    hits_made_lost:      Number(hitsCycle?.made_lost?? 0),
    hits_received_cycle: Number(hitsCycle?.received ?? 0),
  };
}

export async function getPlayerActivity(address, limit = 100, offset = 0) {
  const addr = address.toLowerCase();
  // Recorded transfers only. The wallet inspector adds synthetic
  // "in-progress" entries client-side from the live /api/monitor companies
  // array, so an op that just started surfaces in ≤3 s without waiting on
  // companies.trade_type to be populated by syncCompanyStarts.
  // LEFT JOIN hits → returns hit_cost on rows that belong to a hit tx,
  // so the UI can show net (mint − cost) for HIT rows.
  return db()`
    SELECT t.hash, t.log_index, t.timestamp, t.from_addr, t.to_addr, t.amount,
           t.kind, t.op_type, t.result,
           h.cost AS hit_cost, h.stolen AS hit_stolen, h.kept AS hit_kept
    FROM transfers t
    LEFT JOIN hits h ON h.tx_hash = t.hash
    WHERE t.to_addr = ${addr} OR t.from_addr = ${addr}
    ORDER BY t.timestamp DESC, t.log_index DESC LIMIT ${limit} OFFSET ${offset}`;
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
  // "Farmed daily" reflects farming activity only — game-op MINTs for `earned`
  // and asset/level-up/enterprise burns for `spent`. HIT, HIT_COST, HIT_REFUND
  // are deliberately excluded from earned/spent/ops/completed/busted so the
  // chart and win-rate aren't perturbed by raid (hit) activity.
  return db()`
    SELECT
      TO_CHAR(TO_TIMESTAMP(timestamp::float), 'YYYY-MM-DD') AS day,
      ROUND(SUM(CASE WHEN kind='MINT' AND to_addr = ${addr}
                       AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','SCRAP')
                     THEN amount ELSE 0 END)::numeric, 0) AS earned,
      ROUND(SUM(CASE WHEN kind IN ('SPEND','BURN') AND from_addr = ${addr}
                       AND op_type IN ('BUY_ASSET','LEVEL_UP','ENTERPRISE','THIRD_ENTERPRISE','FOURTH_ENTERPRISE')
                     THEN amount ELSE 0 END)::numeric, 0) AS spent,
      SUM(CASE WHEN kind='MINT' AND to_addr = ${addr}
                 AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','SCRAP')
            THEN 1 ELSE 0 END) AS ops,
      SUM(CASE WHEN kind='MINT' AND to_addr = ${addr}
                 AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION') AND result = 'completed'
            THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN kind='MINT' AND to_addr = ${addr}
                 AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION') AND result = 'busted'
            THEN 1 ELSE 0 END) AS busted
    FROM transfers
    WHERE (to_addr = ${addr} OR from_addr = ${addr}) AND kind IN ('MINT','SPEND','BURN')
    GROUP BY day ORDER BY day ASC`;
}
