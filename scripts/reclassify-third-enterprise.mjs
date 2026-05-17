// One-shot backfill: retag SPEND/BURN rows that came from a THIRD_ENTERPRISE
// purchase (tx selector 0x25c3fa62 on the game contract) but were originally
// mis-tagged as BURN or BUY_ASSET because the classifier only relied on the
// amount>6000 heuristic.
//
// Run on each DB:
//   node --env-file=.env scripts/reclassify-third-enterprise.mjs

import { getDb } from '../lib/db/connection.js';
import { rpcBatch } from '../server/etherscan/rpc-client.js';

const db = getDb();
const TE_SELECTOR = '0x25c3fa62';
const CHUNK       = 100;

async function run() {
  // Pull every distinct hash of a SPEND/BURN row that ISN'T already
  // tagged THIRD_ENTERPRISE — we only need to inspect candidates.
  const wrong = await db`
    SELECT DISTINCT hash
    FROM transfers
    WHERE kind IN ('SPEND','BURN')
      AND op_type != 'THIRD_ENTERPRISE'`;
  console.log(`[te-backfill] inspecting ${wrong.length} distinct tx hashes`);

  const teHashes = [];
  for (let i = 0; i < wrong.length; i += CHUNK) {
    const chunk = wrong.slice(i, i + CHUNK);
    const reqs  = chunk.map((r, j) => ({ method: 'eth_getTransactionByHash', params: [r.hash], id: j }));
    const res   = await rpcBatch(reqs, 30000).catch(() => []);
    for (const r of (Array.isArray(res) ? res : [])) {
      const tx = r.result;
      if (!tx) continue;
      const sel = (tx.input || '0x').slice(0, 10).toLowerCase();
      if (sel === TE_SELECTOR) teHashes.push(tx.hash);
    }
    if (i % 1000 === 0 && i > 0) {
      process.stdout.write(`  …${i}/${wrong.length}  candidates=${teHashes.length}\n`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`[te-backfill] found ${teHashes.length} TE txs needing retag`);

  if (teHashes.length === 0) { console.log('nothing to do.'); process.exit(0); }

  // Only retag SPEND/BURN rows (we don't want to clobber MINT rows from the
  // same tx — e.g. a refund). For TE txs all DIRTY transfers should be to ZERO,
  // but the constraint keeps us safe.
  const res = await db`
    UPDATE transfers SET kind = 'SPEND', op_type = 'THIRD_ENTERPRISE'
    WHERE hash = ANY(${teHashes})
      AND kind IN ('SPEND','BURN')
      AND op_type != 'THIRD_ENTERPRISE'`;
  console.log(`[te-backfill] rows updated: ${res.count}`);

  // Final state summary
  const stats = await db`
    SELECT TO_CHAR(TO_TIMESTAMP(timestamp::float), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS cnt,
           ROUND(SUM(amount)::numeric, 0) AS total
    FROM transfers WHERE kind = 'SPEND' AND op_type = 'THIRD_ENTERPRISE'
    GROUP BY day ORDER BY day`;
  console.log('\nTHIRD_ENTERPRISE rows by day after backfill:');
  stats.forEach(s => console.log(`  ${s.day}  cnt=${s.cnt}  total=${s.total}`));
  process.exit(0);
}
run().catch(err => { console.error(err); process.exit(1); });
