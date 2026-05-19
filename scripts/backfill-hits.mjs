// One-shot backfill for the Hits mechanic (Season 2).
//
// For each HitResolved event in [fromBlock, latest]:
//   1. INSERT into `hits` table.
//   2. UPDATE transfers SET op_type='HIT' / 'HIT_REFUND' on the attacker's
//      and victim's MINT rows (matched by tx_hash + to_addr).
//   3. DELETE any synthesized bust row for the victim's killed trade
//      (liquidations.js inserted these when the hit-skip filter wasn't
//      yet deployed). Identified by tx_hash + kind='MINT' + amount equal
//      to what fetchLiquidationEvents reported (parsed from E_EXITED data).
//
// Run on the VPS:
//   cd /opt/offshore-dashboard
//   node --env-file=.env scripts/backfill-hits.mjs
//
// Defaults to scanning from a Season 2 starting block. Override via argv:
//   node scripts/backfill-hits.mjs <fromBlock>

import { getDb } from '../lib/index.js';
import { fetchHitEvents } from '../server/etherscan.js';
import { upsertHits, retagHitCosts } from '../lib/db/hits.js';
import { getLatestBlock } from '../server/etherscan.js';

const db = getDb();

const SEASON2_START_BLOCK = 16_298_589; // ~2026-05-18 09:30 UTC at 1s/block
const fromArg = Number(process.argv[2] ?? SEASON2_START_BLOCK);
const latest  = await getLatestBlock();
console.log(`Scanning blocks ${fromArg} → ${latest} for HitResolved events…`);

const BATCH = 20_000;
let totalHits = 0;
let txsUpdated = 0;
let dupsDeleted = 0;

for (let from = fromArg; from <= latest; from += BATCH) {
  const to = Math.min(from + BATCH - 1, latest);
  process.stdout.write(`\r  blocks ${from}..${to}  hits=${totalHits}  `);
  let ctx;
  try {
    ctx = await fetchHitEvents(from, to);
  } catch (err) {
    console.warn(`\n  fetchHitEvents ${from}..${to} failed: ${err.message}`);
    continue;
  }
  if (!ctx.hits.length) { await new Promise(r => setTimeout(r, 100)); continue; }
  totalHits += ctx.hits.length;
  await upsertHits(ctx.hits);

  // Retag attacker & victim MINTs in transfers
  for (const h of ctx.hits) {
    const a = await db`
      UPDATE transfers SET op_type='HIT', result=
        CASE WHEN amount > ${h.cost} THEN 'completed' ELSE 'busted' END
      WHERE hash = ${h.hash} AND kind='MINT' AND to_addr = ${h.attacker}`;
    const v = await db`
      UPDATE transfers SET op_type='HIT_REFUND', result='busted'
      WHERE hash = ${h.hash} AND kind='MINT' AND to_addr = ${h.victim}
        AND op_type IN ('PARTIAL','EXTORTION','ARMS_DEAL','DRUG_DEAL')
        AND ABS(amount - ${h.kept}) < 0.001`;
    txsUpdated += (a.count + v.count);

    // Delete the synthesized bust row from liquidations.js (if present).
    // It uses the E_EXITED log_index; the real victim MINT uses the DIRTY
    // transfer's log_index. So a duplicate has the same tx_hash but is the
    // "extra" row whose amount doesn't match the kept value.
    const d = await db`
      DELETE FROM transfers
      WHERE hash = ${h.hash} AND kind='MINT' AND to_addr = ${h.victim}
        AND op_type IN ('EXTORTION','ARMS_DEAL','DRUG_DEAL')
        AND ABS(amount - ${h.kept}) >= 0.001`;
    dupsDeleted += d.count;
  }
  await new Promise(r => setTimeout(r, 200));
}
// Pass 2: retag the corresponding cost burns as HIT_COST.
console.log('\nRetagging cost burns as HIT_COST…');
const allHits = await db`SELECT tx_hash AS hash, block_num, attacker, cost FROM hits ORDER BY block_num`;
const retagged = await retagHitCosts(allHits.map(h => ({ hash: h.hash, blockNum: Number(h.block_num), attacker: h.attacker, cost: Number(h.cost) })));
console.log(`  retagged: ${retagged}`);

console.log(`\nDone. Hits indexed: ${totalHits}, transfer rows retagged: ${txsUpdated}, duplicate busts deleted: ${dupsDeleted}, HIT_COST burns: ${retagged}`);
process.exit(0);
