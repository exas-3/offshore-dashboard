// Creates influence_daily table and backfills purchased/consumed/refunded/net per day.
// Safe to re-run — uses INSERT ... ON CONFLICT DO UPDATE (upsert).
// Run: node --env-file=.env scripts/backfill-influence-daily.js

import { getDb } from '../lib/index.js';

const db = getDb();

await db`
  CREATE TABLE IF NOT EXISTS influence_daily (
    day_ts    BIGINT PRIMARY KEY,
    purchased DOUBLE PRECISION NOT NULL DEFAULT 0,
    consumed  DOUBLE PRECISION NOT NULL DEFAULT 0,
    refunded  DOUBLE PRECISION NOT NULL DEFAULT 0,
    net       DOUBLE PRECISION NOT NULL DEFAULT 0
  )
`;
console.log('table ready');

const rows = await db`
  SELECT
    FLOOR(timestamp / 86400)::BIGINT * 86400          AS day_ts,
    SUM(CASE WHEN kind = 'MINT' THEN amount ELSE 0 END)::DOUBLE PRECISION AS minted,
    SUM(CASE WHEN kind = 'BURN' THEN amount ELSE 0 END)::DOUBLE PRECISION AS consumed,
    SUM(CASE WHEN kind = 'MINT' AND NOT EXISTS (
      SELECT 1 FROM transfers t WHERE t.hash = influence_transfers.hash LIMIT 1
    ) THEN amount ELSE 0 END)::DOUBLE PRECISION AS purchased
  FROM influence_transfers
  WHERE kind IN ('MINT', 'BURN') AND timestamp > 0
  GROUP BY 1
  ORDER BY 1 ASC
`;

console.log(`computed ${rows.length} daily buckets`);

for (const r of rows) {
  const refunded = Math.max(0, r.minted - r.purchased);
  const net      = r.purchased + refunded - r.consumed;
  await db`
    INSERT INTO influence_daily (day_ts, purchased, consumed, refunded, net)
    VALUES (${Number(r.day_ts)}, ${r.purchased}, ${r.consumed}, ${refunded}, ${net})
    ON CONFLICT (day_ts) DO UPDATE SET
      purchased = EXCLUDED.purchased,
      consumed  = EXCLUDED.consumed,
      refunded  = EXCLUDED.refunded,
      net       = EXCLUDED.net
  `;
}

console.log('done');
process.exit(0);
