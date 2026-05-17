// One-shot backfill: use the factory's D47 (OpResult) event to retag busts and
// populate the new `result` column on every game-op MINT row.
//
// Two passes:
//   (1) Reclassify PARTIAL MINT rows that have a D47 event in the same tx.
//       Word0 of the D47 data tells the trade type: 750=DRUG_DEAL,
//       250=ARMS_DEAL, 80=EXTORTION.
//   (2) Set result = 'completed' (amount in 100/115/130) or 'busted' (else)
//       for every DRUG_DEAL/ARMS_DEAL/EXTORTION MINT row.
//
// Run on each DB after `ALTER TABLE transfers ADD COLUMN result text`:
//   node --env-file=.env scripts/reclassify-busts-with-d47.mjs

import { getDb } from '../lib/db/connection.js';
import { FACTORY } from '../lib/chain-constants.js';

const db = getDb();
const FACTORY_LC = FACTORY.toLowerCase();
const E_D47 = '0xd47648dbe74844d41eea0e3e6bf1d3f6f03cd31691e10e6edc7376d52b934dbd';

function word0OpType(dataHex) {
  // data is '0x<64 hex chars>'. word0 is at chars 60..64 of the stripped hex.
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
  console.log('[backfill] starting…');

  // ── 1. Reclassify PARTIAL → DRUG/ARMS/EXTORTION via D47 ──────────────────
  const partials = await db`
    SELECT hash FROM transfers
    WHERE kind = 'MINT' AND op_type = 'PARTIAL'`;
  console.log(`  PARTIAL MINT rows to inspect: ${partials.length}`);

  let retagged = { DRUG_DEAL: 0, ARMS_DEAL: 0, EXTORTION: 0 };
  const CHUNK = 1000;
  for (let i = 0; i < partials.length; i += CHUNK) {
    const hashes = partials.slice(i, i + CHUNK).map(r => r.hash);
    const d47Rows = await db`
      SELECT tx_hash, data
      FROM idx_logs
      WHERE address = ${FACTORY_LC} AND topic0 = ${E_D47} AND tx_hash = ANY(${hashes})`;
    // Map tx_hash → opType (first D47 wins per tx)
    const byTx = new Map();
    for (const r of d47Rows) {
      if (byTx.has(r.tx_hash)) continue;
      const op = word0OpType(r.data);
      if (op) byTx.set(r.tx_hash, op);
    }
    for (const [tx, op] of byTx) {
      const res = await db`
        UPDATE transfers SET op_type = ${op}
        WHERE hash = ${tx} AND kind = 'MINT' AND op_type = 'PARTIAL'`;
      retagged[op] += res.count ?? 0;
    }
    if ((i / CHUNK) % 5 === 0) console.log(`    …${i + hashes.length}/${partials.length}`);
  }
  console.log(`  retagged: drug=${retagged.DRUG_DEAL}  arms=${retagged.ARMS_DEAL}  extortion=${retagged.EXTORTION}`);

  // ── 2. Populate result column for every game-op MINT row ─────────────────
  // Completed payouts are exactly 100, 115, or 130 DIRTY (location-dependent).
  // Anything else is a busted op with proportionate refund.
  const completed = await db`
    UPDATE transfers SET result = 'completed'
    WHERE kind = 'MINT'
      AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION')
      AND amount IN (100, 115, 130)
      AND (result IS NULL OR result != 'completed')`;
  const busted = await db`
    UPDATE transfers SET result = 'busted'
    WHERE kind = 'MINT'
      AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION')
      AND amount NOT IN (100, 115, 130)
      AND (result IS NULL OR result != 'busted')`;
  console.log(`  result populated: completed=${completed.count}  busted=${busted.count}`);

  // ── 3. Summary ───────────────────────────────────────────────────────────
  const summary = await db`
    SELECT op_type, result, COUNT(*)::int AS cnt
    FROM transfers
    WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION')
    GROUP BY op_type, result ORDER BY op_type, result`;
  console.log('\n  final state:');
  summary.forEach(r => console.log(`    ${r.op_type.padEnd(10)} ${String(r.result).padEnd(10)} ${r.cnt}`));

  console.log('\n[backfill] done.');
  process.exit(0);
}
run().catch(err => { console.error(err); process.exit(1); });
