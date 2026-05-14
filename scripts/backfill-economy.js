// Creates and populates the economy_buckets table.
// Value added  = INF purchased (1 INF = 1 USDm always).
// Value extracted = DIRTY net (minted - burned) × DIRTY price in USDm.
// DIRTY price is the avg price in each bucket, carry-forwarded into empty buckets.
// Safe to re-run — uses UPSERT.
//
// Run: node scripts/backfill-economy.js

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(join(__dir, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, {
  max: 3, idle_timeout: 30, connect_timeout: 10,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

const PROTOCOL_ADDRS = ['0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462'];

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS economy_buckets (
      ts                BIGINT           NOT NULL,
      unit              INTEGER          NOT NULL,
      inf_purchased     DOUBLE PRECISION NOT NULL DEFAULT 0,
      dirty_minted      DOUBLE PRECISION NOT NULL DEFAULT 0,
      dirty_burned      DOUBLE PRECISION NOT NULL DEFAULT 0,
      price_dirty_usdm  DOUBLE PRECISION NOT NULL DEFAULT 0,
      PRIMARY KEY (ts, unit)
    )`;
  await sql`ALTER TABLE economy_buckets ADD COLUMN IF NOT EXISTS price_dirty_usdm DOUBLE PRECISION NOT NULL DEFAULT 0`;
  console.log('[economy] Table ready.');
}

async function computeAndStore(unit) {
  const label = unit === 3600 ? 'hourly' : 'daily';
  console.log(`[economy] Computing ${label} buckets…`);

  const rows = await sql`
    WITH
    -- DIRTY token flow per bucket (excludes protocol mints)
    dirty_flow AS (
      SELECT
        (FLOOR(timestamp::float / ${unit}) * ${unit})::BIGINT AS ts,
        SUM(CASE WHEN kind = 'MINT'             THEN amount ELSE 0 END) AS dirty_minted,
        SUM(CASE WHEN kind IN ('BURN','SPEND')  THEN amount ELSE 0 END) AS dirty_burned
      FROM transfers
      WHERE kind IN ('MINT','BURN','SPEND')
        AND to_addr != '0x0000000000000000000000000000000000000000'
        AND NOT (kind = 'MINT' AND to_addr = ANY(${PROTOCOL_ADDRS}))
      GROUP BY 1
    ),
    -- INF purchased with real USDm (excludes refunds)
    inf_flow AS (
      SELECT
        (FLOOR(timestamp::float / ${unit}) * ${unit})::BIGINT AS ts,
        SUM(amount) AS inf_purchased
      FROM influence_transfers
      WHERE kind = 'MINT' AND timestamp > 0
        AND NOT EXISTS (
          SELECT 1 FROM transfers t WHERE t.hash = influence_transfers.hash LIMIT 1
        )
      GROUP BY 1
    ),
    -- Average DIRTY/USDm price per bucket
    dirty_price AS (
      SELECT
        (FLOOR(ts::float / ${unit}) * ${unit})::BIGINT AS ts,
        AVG(price_usdm_per_dirty)::float               AS price
      FROM v_dex_swaps
      GROUP BY 1
    ),
    -- All time slots from first event to latest
    slots AS (
      SELECT generate_series(
        LEAST(
          (SELECT (FLOOR(MIN(timestamp)::float / ${unit}) * ${unit})::BIGINT FROM transfers),
          (SELECT (FLOOR(MIN(timestamp)::float / ${unit}) * ${unit})::BIGINT FROM influence_transfers WHERE timestamp > 0)
        ),
        GREATEST(
          (SELECT (FLOOR(MAX(timestamp)::float / ${unit}) * ${unit})::BIGINT FROM transfers),
          (SELECT (FLOOR(MAX(timestamp)::float / ${unit}) * ${unit})::BIGINT FROM influence_transfers WHERE timestamp > 0)
        ),
        ${unit}
      ) AS ts
    ),
    -- Join slots with raw price, then group for carry-forward
    slots_with_price AS (
      SELECT s.ts,
             p.price,
             COUNT(p.price) OVER (ORDER BY s.ts) AS grp
      FROM slots s
      LEFT JOIN dirty_price p ON p.ts = s.ts
    ),
    -- Fill forward: each NULL gets the last non-NULL price in its group
    price_filled AS (
      SELECT ts,
             FIRST_VALUE(price) OVER (PARTITION BY grp ORDER BY ts) AS price
      FROM slots_with_price
    )
    SELECT
      s.ts,
      ${unit}                              AS unit,
      COALESCE(inf.inf_purchased,  0)      AS inf_purchased,
      COALESCE(df.dirty_minted,    0)      AS dirty_minted,
      COALESCE(df.dirty_burned,    0)      AS dirty_burned,
      COALESCE(pf.price,           0)      AS price_dirty_usdm
    FROM slots s
    LEFT JOIN dirty_flow  df  ON df.ts  = s.ts
    LEFT JOIN inf_flow    inf ON inf.ts = s.ts
    LEFT JOIN price_filled pf ON pf.ts  = s.ts
    ORDER BY s.ts`;

  if (!rows.length) { console.log(`[economy] No data for ${label}.`); return; }

  const values = rows.map(r => ({
    ts:               Number(r.ts),
    unit,
    inf_purchased:    Number(r.inf_purchased),
    dirty_minted:     Number(r.dirty_minted),
    dirty_burned:     Number(r.dirty_burned),
    price_dirty_usdm: Number(r.price_dirty_usdm),
  }));

  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await sql`
      INSERT INTO economy_buckets ${sql(values.slice(i, i + CHUNK))}
      ON CONFLICT (ts, unit) DO UPDATE SET
        inf_purchased    = EXCLUDED.inf_purchased,
        dirty_minted     = EXCLUDED.dirty_minted,
        dirty_burned     = EXCLUDED.dirty_burned,
        price_dirty_usdm = EXCLUDED.price_dirty_usdm`;
  }

  // Show a sample
  const sample = values.slice(-3);
  sample.forEach(r => {
    const net = r.dirty_minted - r.dirty_burned;
    console.log(`  ts=${r.ts}  inf_usdm=${r.inf_purchased.toFixed(0)}  dirty_net_usdm=${(net * r.price_dirty_usdm).toFixed(0)}  price=${r.price_dirty_usdm.toFixed(4)}`);
  });
  console.log(`[economy] ${label}: ${rows.length} buckets stored.`);
}

await ensureTable();
await computeAndStore(3600);
await computeAndStore(86400);
console.log('[economy] Done.');
process.exit(0);
