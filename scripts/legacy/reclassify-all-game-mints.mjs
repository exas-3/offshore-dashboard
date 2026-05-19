// Comprehensive reclassification: for every MINT row in `transfers` tagged
// DRUG_DEAL / ARMS_DEAL / EXTORTION / PARTIAL, cross-check against the D47
// (OpResult) event from the factory and retag if the row disagrees with chain
// truth. ~30% of historical rows were mis-tagged because the old code fell back
// to the (broken) tradeType() selector — it returns 2 for every company, so
// drug deals got mass-tagged ARMS_DEAL whenever the d47Map exact-log-index
// lookup missed.
//
// After op_type fixes, repopulates the `result` column from amount.
//
// Run on each DB after deploy:
//   node --env-file=.env scripts/reclassify-all-game-mints.mjs

import { getDb } from '../lib/db/connection.js';
import { FACTORY } from '../lib/chain-constants.js';

const db = getDb();
const FACTORY_LC = FACTORY.toLowerCase();
const E_D47 = '0xd47648dbe74844d41eea0e3e6bf1d3f6f03cd31691e10e6edc7376d52b934dbd';
const GAME_OPS = ['DRUG_DEAL', 'ARMS_DEAL', 'EXTORTION', 'PARTIAL'];

function word0OpType(dataHex) {
  if (!dataHex || dataHex === '0x') return null;
  const raw = dataHex.slice(2);
  if (raw.length < 64) return null;
  const w0 = parseInt(raw.slice(60, 64), 16);
  if (w0 === 750) return 'DRUG_DEAL';
  if (w0 === 250) return 'ARMS_DEAL';
  if (w0 ===  80) return 'EXTORTION';
  return null;
}

async function run() {
  console.log('[reclassify] starting comprehensive game-MINT D47 audit…');

  // Iterate rows in block_num chunks to keep memory bounded.
  const [minRow] = await db`SELECT MIN(block_num)::bigint AS bn FROM transfers WHERE kind = 'MINT' AND op_type = ANY(${GAME_OPS})`;
  const [maxRow] = await db`SELECT MAX(block_num)::bigint AS bn FROM transfers WHERE kind = 'MINT' AND op_type = ANY(${GAME_OPS})`;
  const blockMin = Number(minRow.bn ?? 0);
  const blockMax = Number(maxRow.bn ?? 0);
  if (!blockMax) { console.log('  no rows. done.'); process.exit(0); }
  console.log(`  block range: ${blockMin} … ${blockMax}`);

  const STEP = 50_000;
  const counters = { scanned: 0, agree: 0, retagged: 0, noD47: 0 };
  const retagBreakdown = {};

  for (let bn = blockMin; bn <= blockMax; bn += STEP) {
    const end = Math.min(bn + STEP - 1, blockMax);

    const rows = await db`
      SELECT hash, op_type
      FROM transfers
      WHERE kind = 'MINT' AND op_type = ANY(${GAME_OPS})
        AND block_num BETWEEN ${bn} AND ${end}`;
    if (!rows.length) continue;

    const hashes = [...new Set(rows.map(r => r.hash))];
    const d47s = await db`
      SELECT tx_hash, data
      FROM idx_logs
      WHERE address = ${FACTORY_LC} AND topic0 = ${E_D47}
        AND block_num BETWEEN ${bn} AND ${end}
        AND tx_hash = ANY(${hashes})`;
    const truthByTx = new Map();
    for (const r of d47s) {
      if (truthByTx.has(r.tx_hash)) continue;
      const op = word0OpType(r.data);
      if (op) truthByTx.set(r.tx_hash, op);
    }

    // Group rows that need retagging by (current_op, new_op) so we can issue
    // one UPDATE per pair instead of one per row.
    const pairs = new Map();
    for (const r of rows) {
      counters.scanned++;
      const truth = truthByTx.get(r.hash);
      if (!truth) { counters.noD47++; continue; }
      if (truth === r.op_type) { counters.agree++; continue; }
      const k = r.op_type + '→' + truth;
      if (!pairs.has(k)) pairs.set(k, { from: r.op_type, to: truth, hashes: [] });
      pairs.get(k).hashes.push(r.hash);
    }
    for (const { from, to, hashes } of pairs.values()) {
      // Update only MINT rows of the wrong op_type for these tx_hashes.
      const res = await db`
        UPDATE transfers SET op_type = ${to}
        WHERE kind = 'MINT' AND op_type = ${from} AND hash = ANY(${hashes})`;
      counters.retagged += res.count ?? 0;
      const k = `${from}→${to}`;
      retagBreakdown[k] = (retagBreakdown[k] || 0) + (res.count ?? 0);
    }

    if (((bn - blockMin) / STEP | 0) % 10 === 0) {
      process.stdout.write(`  …block ${bn}/${blockMax}  scanned=${counters.scanned}  retagged=${counters.retagged}\n`);
    }
  }

  console.log(`\n  audit done:`);
  console.log(`    scanned:   ${counters.scanned}`);
  console.log(`    agree:     ${counters.agree}`);
  console.log(`    no D47:    ${counters.noD47}`);
  console.log(`    retagged:  ${counters.retagged}`);
  if (Object.keys(retagBreakdown).length) {
    console.log(`\n  retag breakdown:`);
    for (const k of Object.keys(retagBreakdown).sort((a, b) => retagBreakdown[b] - retagBreakdown[a])) {
      console.log(`    ${k.padEnd(28)} ${retagBreakdown[k]}`);
    }
  }

  // Re-populate result column for everything we touched (also catches any rows
  // that were rolled into a different op_type for the first time).
  console.log(`\n  refreshing result column…`);
  const compRes = await db`
    UPDATE transfers SET result = 'completed'
    WHERE kind = 'MINT'
      AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION')
      AND amount IN (100, 115, 130)
      AND (result IS NULL OR result != 'completed')`;
  const bustRes = await db`
    UPDATE transfers SET result = 'busted'
    WHERE kind = 'MINT'
      AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION')
      AND amount NOT IN (100, 115, 130)
      AND (result IS NULL OR result != 'busted')`;
  console.log(`    result updated: completed=${compRes.count}  busted=${bustRes.count}`);

  // Final state summary
  const summary = await db`
    SELECT op_type, result, COUNT(*)::int AS cnt
    FROM transfers
    WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION')
    GROUP BY op_type, result ORDER BY op_type, result`;
  console.log(`\n  final state:`);
  summary.forEach(r => console.log(`    ${r.op_type.padEnd(10)} ${String(r.result).padEnd(10)} ${r.cnt}`));

  console.log('\n[reclassify] done.');
  process.exit(0);
}
run().catch(err => { console.error(err); process.exit(1); });
