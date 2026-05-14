// Fix 19,214 transfer rows where the old syncLiquidations code stored the company
// contract address as to_addr (instead of the real player from E_EXITED topic2)
// and stored amount=0 (instead of the actual wei amount from data).
//
// These were later mis-classified as EXTORTION because amount=0 was treated as a
// busted extortion. In reality all 19,214 rows have non-zero dirty amounts and are
// busted drugs/arms deals. After this fix they become PARTIAL rows, which
// reclassify-partials.mjs can then resolve to DRUG_DEAL/ARMS_DEAL.
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const f of ['.env.local', '.env']) {
  try {
    const env = readFileSync(resolve('/home/work/offshore-dashboard', f), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

const { getDb } = await import('../lib/index.js');
const db = getDb();

const E_EXITED = '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff';

// Verify scope before touching anything
const [before] = await db`
  SELECT COUNT(*)::int AS bad_rows, COUNT(DISTINCT t.to_addr)::int AS bad_wallets
  FROM transfers t
  WHERE t.kind = 'MINT' AND t.op_type = 'EXTORTION'
    AND t.to_addr IN (SELECT address FROM companies)
`;
console.log(`Bad rows to fix: ${before.bad_rows} rows across ${before.bad_wallets} company addresses`);
if (before.bad_rows === 0) { console.log('Nothing to do.'); process.exit(0); }

// Fetch bad rows joined with idx_logs to get correct player + amount
const rows = await db`
  SELECT t.hash, t.log_index,
         '0x' || RIGHT(il.topic2, 40) AS player,
         il.data AS wei_hex
  FROM transfers t
  JOIN idx_logs il ON il.tx_hash = t.hash AND il.log_index = t.log_index AND il.topic0 = ${E_EXITED}
  WHERE t.kind = 'MINT' AND t.op_type = 'EXTORTION'
    AND t.to_addr IN (SELECT address FROM companies)
`;
console.log(`Rows to update: ${rows.length}`);

// Convert and batch update in chunks of 500
const CHUNK = 500;
let updated = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  // Build typed arrays for unnest
  const hashes    = chunk.map(r => r.hash);
  const logIdxs   = chunk.map(r => Number(r.log_index));
  const players   = chunk.map(r => r.player.toLowerCase());
  const amounts   = chunk.map(r => {
    const wei = r.wei_hex && r.wei_hex !== '0x' ? BigInt(r.wei_hex) : 0n;
    return String(Number(wei) / 1e18);
  });
  const rawValues = chunk.map(r => {
    const wei = r.wei_hex && r.wei_hex !== '0x' ? BigInt(r.wei_hex) : 0n;
    return String(wei);
  });

  await db`
    UPDATE transfers t
    SET to_addr   = v.player,
        amount    = v.amount::numeric,
        raw_value = v.raw_value,
        op_type   = 'PARTIAL'
    FROM (
      SELECT UNNEST(${hashes}::text[])    AS hash,
             UNNEST(${logIdxs}::int[])    AS log_index,
             UNNEST(${players}::text[])   AS player,
             UNNEST(${amounts}::text[])   AS amount,
             UNNEST(${rawValues}::text[]) AS raw_value
    ) v
    WHERE t.hash = v.hash AND t.log_index = v.log_index
      AND t.kind = 'MINT' AND t.op_type = 'EXTORTION'
  `;
  updated += chunk.length;
  process.stdout.write(`\r  ${updated}/${rows.length}`);
}
console.log(`\nUpdated: ${updated} rows`);

// Verify no bad rows remain
const [after] = await db`
  SELECT COUNT(*)::int AS bad_rows
  FROM transfers t
  WHERE t.kind = 'MINT' AND t.op_type IN ('EXTORTION','PARTIAL')
    AND t.to_addr IN (SELECT address FROM companies)
`;
console.log(`Remaining company-addr rows: ${after.bad_rows}`);

// New player count
const [players] = await db`
  SELECT COUNT(DISTINCT to_addr)::int AS cnt
  FROM transfers WHERE kind='MINT'
    AND to_addr != '0x0000000000000000000000000000000000000000'
`;
console.log(`\nPlayer count after fix: ${players.cnt}`);

// Op type distribution
const dist = await db`
  SELECT op_type, COUNT(*)::int AS n FROM transfers
  WHERE kind='MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL','SCRAP')
  GROUP BY op_type ORDER BY n DESC
`;
console.log('\nOp distribution:');
for (const r of dist) console.log(`  ${r.op_type}: ${r.n}`);

process.exit(0);
