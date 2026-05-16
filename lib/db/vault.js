import { getDb } from './connection.js';
const db = () => getDb();

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
