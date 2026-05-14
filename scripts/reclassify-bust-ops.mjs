// Reclassify busted operations:
//   FAIL (amount=0 mint) → EXTORTION (busted extortions always produce 0)
//   PARTIAL → DRUG_DEAL / ARMS_DEAL / EXTORTION (using DirtyPaid company + trade type)
//
// Uses player+amount matching to correctly pair each DIRTY Transfer to the DirtyPaid
// event in the same tx, even for batched operations with multiple companies.

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

const FACTORY  = '0x619814a203ca441611cee02abf31986ca265dd35';
const E_PAYOUT = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502';

// ── Step 1: FAIL → EXTORTION ──────────────────────────────────────────────────
console.log('Step 1: Reclassifying FAIL → EXTORTION...');
const failResult = await db`
  UPDATE transfers SET op_type = 'EXTORTION'
  WHERE kind = 'MINT' AND op_type = 'FAIL'
`;
console.log(`  Updated ${failResult.count} rows`);

// ── Step 2: PARTIAL → DRUG_DEAL / ARMS_DEAL / EXTORTION ──────────────────────
// Uses historical COMPANY_MODE_SET events from idx_logs (not a latest-block RPC call)
// so companies that have since been destroyed are still correctly classified.
console.log('\nStep 2: Reclassifying PARTIAL rows using historical company mode...');

const totalPartial = await db`SELECT COUNT(*) as c FROM transfers WHERE kind='MINT' AND op_type='PARTIAL'`;
console.log(`  Total PARTIAL rows: ${totalPartial[0].c}`);

const E_MODE = '0x45bbfdba894613978e2020519389850b832e46047255c75de8039b91d5406608';

// Join each PARTIAL transfer to its DirtyPaid event (matched by player+amount),
// then look up the most recent COMPANY_MODE_SET for that company before the trade.
const matches = await db`
  SELECT
    t.hash,
    COALESCE(
      (SELECT CASE WHEN LENGTH(ms.data) >= 66 THEN RIGHT(ms.data, 1)::INTEGER ELSE 0 END
       FROM idx_logs ms
       WHERE ms.topic0  = ${E_MODE}
         AND ms.address = LOWER('0x' || RIGHT(dp.topic1, 40))
         AND (ms.block_num < t.block_num
              OR (ms.block_num = t.block_num AND ms.log_index < dp.log_index))
       ORDER BY ms.block_num DESC, ms.log_index DESC
       LIMIT 1),
      0
    ) AS mode
  FROM transfers t
  JOIN idx_logs dp ON dp.tx_hash = t.hash
    AND dp.address = ${FACTORY}
    AND dp.topic0  = ${E_PAYOUT}
    AND LOWER('0x' || RIGHT(dp.topic2, 40)) = t.to_addr
    AND ABS(hex_word(dp.data, 0)::numeric / 1e18 - t.amount::numeric) < 0.0001
  WHERE t.kind = 'MINT' AND t.op_type = 'PARTIAL'
`;
console.log(`  Matched ${matches.length} PARTIAL rows`);

const dist = {};
for (const r of matches) dist[r.mode] = (dist[r.mode] || 0) + 1;
for (const [m, n] of Object.entries(dist).sort()) {
  const label = { 0: 'unknown (backfill pending)', 1: 'DRUG_DEAL', 2: 'ARMS_DEAL', 3: 'EXTORTION' }[m] ?? `unknown(${m})`;
  console.log(`  mode=${m} (${label}): ${n}`);
}

// Build update buckets by op_type (skip mode=0 — indexer hasn't backfilled those yet)
const byType = { DRUG_DEAL: [], ARMS_DEAL: [], EXTORTION: [] };
for (const row of matches) {
  if (row.mode === 1) byType.DRUG_DEAL.push(row.hash);
  else if (row.mode === 2) byType.ARMS_DEAL.push(row.hash);
  else if (row.mode === 3) byType.EXTORTION.push(row.hash);
}

console.log('\n  Applying updates:');
let totalUpdated = 0;
const CHUNK = 500;
for (const [opType, hashes] of Object.entries(byType)) {
  if (hashes.length === 0) continue;
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const chunk = hashes.slice(i, i + CHUNK);
    await db`UPDATE transfers SET op_type = ${opType} WHERE hash = ANY(${chunk}) AND kind = 'MINT' AND op_type = 'PARTIAL'`;
    totalUpdated += chunk.length;
  }
  console.log(`  → ${opType}: ${hashes.length} rows`);
}
console.log(`  Total updated: ${totalUpdated}`);

// Final distribution
console.log('\nFinal MINT op_type distribution:');
const finalDist = await db`
  SELECT op_type, COUNT(*) AS n FROM transfers
  WHERE kind = 'MINT'
  GROUP BY op_type ORDER BY n DESC
`;
for (const r of finalDist) console.log(`  ${r.op_type}: ${r.n}`);

process.exit(0);
