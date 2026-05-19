// One-shot backfill for any rows still tagged op_type='PARTIAL'.
//
// Resolution path (canonical Season 2 logic):
//   1. SELECT remaining PARTIAL rows from `transfers`.
//   2. Pull factory DirtyPaid + TradeExited events from idx_logs for those txs
//      → derive (company addr, block_num) per row.
//   3. Read company storage slots 4/5 at blockNum-1 (getCompanyTradeTypesFromStorage)
//      → end-start duration → op_type (300=EXTORTION, 1800=ARMS, 5400=DRUG).
//   4. Set result = 'completed' if the row has a DirtyPaid event in its tx,
//      'busted' otherwise (TradeExited-only path).
//   5. UPDATE transfers SET op_type, result WHERE hash + log_index match.
//
// Run on the VPS:
//   cd /opt/offshore-dashboard
//   node --env-file=.env scripts/reclassify-partials-by-duration.mjs

import { getDb } from '../lib/index.js';
import { getCompanyTradeTypesFromStorage } from '../server/etherscan.js';

const FACTORY_LC = '0x619814a203ca441611cee02abf31986ca265dd35';
const E_PAYOUT   = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502';
const E_EXITED   = '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff';

const db = getDb();

const partials = await db`
  SELECT hash, log_index, block_num
  FROM transfers
  WHERE kind = 'MINT' AND op_type = 'PARTIAL'
  ORDER BY block_num`;
console.log(`PARTIAL rows: ${partials.length}`);
if (partials.length === 0) { console.log('Nothing to do.'); process.exit(0); }

const hashes = partials.map(r => r.hash.toLowerCase());

// Pull DirtyPaid and TradeExited events for these txs from idx_logs. Each tx
// contains at most one or two (rarely batched), so a single ANY query suffices.
const payoutRows = await db`
  SELECT tx_hash, log_index, '0x' || RIGHT(topic1, 40) AS company, block_num
  FROM idx_logs
  WHERE address = ${FACTORY_LC} AND topic0 = ${E_PAYOUT}
    AND tx_hash = ANY(${hashes})`;
const exitedRows = await db`
  SELECT tx_hash, log_index, '0x' || RIGHT(topic1, 40) AS company, block_num
  FROM idx_logs
  WHERE address = ${FACTORY_LC} AND topic0 = ${E_EXITED}
    AND tx_hash = ANY(${hashes})`;

// Build lookup maps
const payoutByKey  = new Map();  // tx:dirtyLogIdx → { company, block_num }
const exitedByKey  = new Map();  // tx:exitedLogIdx → { company, block_num }
const payoutTxs    = new Set();  // tx_hash (for result determination)
for (const r of payoutRows) {
  const txh = r.tx_hash.toLowerCase();
  payoutTxs.add(txh);
  // DirtyPaid is emitted one log_index AFTER the DIRTY Transfer mint.
  // idx_logs.log_index is smallint (decimal number), NOT a hex string.
  payoutByKey.set(`${txh}:${Number(r.log_index) - 1}`, {
    company: r.company.toLowerCase(),
    block_num: Number(r.block_num),
  });
}
for (const r of exitedRows) {
  const txh = r.tx_hash.toLowerCase();
  exitedByKey.set(`${txh}:${Number(r.log_index)}`, {
    company: r.company.toLowerCase(),
    block_num: Number(r.block_num),
  });
}

// Match each PARTIAL row to a company. Two key formats since transfers.js and
// liquidations.js synthesize MINTs with different log_index meanings.
const matched = [];
const unmatched = [];
for (const r of partials) {
  const key = `${r.hash.toLowerCase()}:${Number(r.log_index)}`;
  const fromPayout = payoutByKey.get(key);
  const fromExited = exitedByKey.get(key);
  if (fromPayout)      matched.push({ row: r, company: fromPayout.company, block_num: fromPayout.block_num, fromPayout: true });
  else if (fromExited) matched.push({ row: r, company: fromExited.company, block_num: fromExited.block_num, fromPayout: false });
  else unmatched.push(r);
}
console.log(`  matched: ${matched.length}, unmatched: ${unmatched.length}`);
if (matched.length === 0) { console.log('No matches; aborting.'); process.exit(0); }

// Build (company → blockNum) map for the storage read at blockNum-1
const companyBlockMap = new Map();
for (const m of matched) {
  if (!companyBlockMap.has(m.company)) companyBlockMap.set(m.company, m.block_num);
}
const uniqueCompanies = [...companyBlockMap.keys()];
console.log(`  unique companies: ${uniqueCompanies.length}`);

console.log('Reading storage slots 4/5 via RPC at blockNum-1…');
const typeMap = await getCompanyTradeTypesFromStorage(uniqueCompanies, companyBlockMap);
console.log(`  resolved types: ${typeMap.size}`);

// Group updates by (op_type, result) for batch UPDATEs
const updates = {
  DRUG_DEAL: { completed: [], busted: [] },
  ARMS_DEAL: { completed: [], busted: [] },
  EXTORTION: { completed: [], busted: [] },
};
let unresolved = 0;
for (const m of matched) {
  const opType = typeMap.get(m.company);
  if (!opType) { unresolved++; continue; }
  const result = m.fromPayout ? 'completed' : 'busted';
  updates[opType][result].push({ hash: m.row.hash, log_index: Number(m.row.log_index) });
}

console.log('\nPlan:');
for (const [opType, buckets] of Object.entries(updates)) {
  for (const [result, items] of Object.entries(buckets)) {
    if (items.length) console.log(`  ${opType} (${result}): ${items.length}`);
  }
}
console.log(`  unresolved: ${unresolved}`);

let totalUpdated = 0;
for (const [opType, buckets] of Object.entries(updates)) {
  for (const [result, items] of Object.entries(buckets)) {
    if (!items.length) continue;
    const hashes  = items.map(i => i.hash);
    const indices = items.map(i => i.log_index);
    const r = await db`
      UPDATE transfers SET op_type = ${opType}, result = ${result}
      WHERE kind = 'MINT' AND op_type = 'PARTIAL'
        AND hash      = ANY(${hashes})
        AND log_index = ANY(${indices})`;
    totalUpdated += r.count;
  }
}
console.log(`\nTotal updated: ${totalUpdated}`);

const after = await db`
  SELECT COUNT(*)::int AS n FROM transfers WHERE kind='MINT' AND op_type='PARTIAL'`;
console.log(`PARTIAL remaining: ${after[0].n}`);

process.exit(0);
