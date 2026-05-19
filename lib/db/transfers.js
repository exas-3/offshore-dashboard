import { getDb, ZERO_ADDR } from './connection.js';
const db = () => getDb();

export async function upsertTransfers(rows) {
  if (!rows.length) return;
  const values = rows.map(r => ({
    hash: r.hash, log_index: r.logIndex ?? 0, block_num: r.blockNum,
    timestamp: r.timestamp, from_addr: r.fromAddr, to_addr: r.toAddr,
    raw_value: r.rawValue ?? String(r.amount), amount: r.amount,
    kind: r.kind, op_type: r.opType ?? '', result: r.result ?? null,
  }));
  // 11 columns per row — stay under postgres's 65534-parameter limit
  const CHUNK = 5000;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db()`INSERT INTO transfers ${db()(values.slice(i, i + CHUNK))}
      ON CONFLICT(hash, log_index) DO NOTHING`;
  }
}

export async function getRecentTransfers(limit = 100, offset = 0) {
  // LEFT JOIN hits so HIT-family rows carry cost / stolen / kept — the
  // activity feed uses these to show the dual +kept / −stolen line on
  // HIT_REFUND rows (the victim's perspective).
  return db()`
    SELECT t.hash, t.log_index, t.timestamp, t.from_addr, t.to_addr, t.amount,
           t.kind, t.op_type, t.result,
           h.cost AS hit_cost, h.stolen AS hit_stolen, h.kept AS hit_kept
    FROM transfers t
    LEFT JOIN hits h ON h.tx_hash = t.hash
    ORDER BY t.timestamp DESC, t.log_index DESC LIMIT ${limit} OFFSET ${offset}`;
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
