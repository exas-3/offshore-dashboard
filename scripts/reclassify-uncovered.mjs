// Reclassify the ~7,787 transfers from recent blocks not yet in idx_logs.
// Uses RPC directly to fetch DirtyPaid and full-completion events.
import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const env = readFileSync(resolve('/home/work/offshore-dashboard', '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
} catch {}
try {
  const env = readFileSync(resolve('/home/work/offshore-dashboard', '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
} catch {}

const { getDb } = await import('../lib/index.js');
const { fetchFactoryTradeContext, getCompanyTradeTypes, _companyTypeCache } = await import('../server/etherscan.js');
const db = getDb();

const FACTORY = '0x619814a203ca441611cee02abf31986ca265dd35';
const E_PAYOUT = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502';

// Get uncovered transfers: in transfers but not covered by idx_logs
const uncovered = await db`
  SELECT t.hash, t.block_num, t.to_addr, t.op_type
  FROM transfers t
  WHERE t.kind = 'MINT' AND t.op_type IN ('DRUG_DEAL','ARMS_DEAL','PARTIAL')
    AND NOT EXISTS (
      SELECT 1 FROM idx_logs il WHERE il.tx_hash = t.hash AND il.address = ${FACTORY} AND il.topic0 = ${E_PAYOUT}
    )
  ORDER BY t.block_num
`;
console.log(`Uncovered records to reclassify: ${uncovered.length}`);

if (uncovered.length === 0) { console.log('Nothing to do.'); process.exit(0); }

// Get block range
const minBlock = Number(uncovered[0].block_num);
const maxBlock = Number(uncovered[uncovered.length - 1].block_num);
console.log(`Block range: ${minBlock} - ${maxBlock}`);

// Build a Set of uncovered tx hashes for fast lookup
const uncoveredHashes = new Set(uncovered.map(r => r.hash.toLowerCase()));

// Fetch factory events in batches of 5000 blocks via RPC
const BLOCK_BATCH = 5000;
const companyMap = new Map();  // tx_hash → company_addr
const fullTxs    = new Set();  // tx_hashes with full-completion event

let processed = 0;
for (let start = minBlock; start <= maxBlock; start += BLOCK_BATCH) {
  const end = Math.min(start + BLOCK_BATCH - 1, maxBlock);
  const ctx = await fetchFactoryTradeContext(start, end).catch(() => ({ companyMap: new Map(), fullTxs: new Set() }));
  for (const [hash, company] of ctx.companyMap) {
    if (uncoveredHashes.has(hash)) companyMap.set(hash, company);
  }
  for (const hash of ctx.fullTxs) {
    if (uncoveredHashes.has(hash)) fullTxs.add(hash);
  }
  processed += BLOCK_BATCH;
  process.stdout.write(`\r  blocks processed: ${processed}/${maxBlock - minBlock}   `);
  await new Promise(r => setTimeout(r, 400));
}
console.log('\n  Factory events fetched.');

// Get trade types for unique companies
const uniqueCompanies = [...new Set([...companyMap.values()])];
console.log(`  Unique companies: ${uniqueCompanies.length}`);
if (uniqueCompanies.length > 0) {
  await getCompanyTradeTypes(uniqueCompanies);
}

// Build update map: tx_hash → new op_type
const updates = {};
for (const row of uncovered) {
  const txh = row.hash.toLowerCase();
  const company = companyMap.get(txh);
  if (!company) continue;  // no factory event found, leave as-is
  const isFull = fullTxs.has(txh);
  let newOp;
  if (!isFull) {
    newOp = 'PARTIAL';
  } else {
    const compType = _companyTypeCache.get(company) ?? 0;
    newOp = compType === 1 ? 'DRUG_DEAL' : compType === 2 ? 'ARMS_DEAL' : 'PARTIAL';
  }
  if (newOp !== row.op_type) {
    if (!updates[newOp]) updates[newOp] = [];
    updates[newOp].push(row.hash);
  }
}

// Apply updates
let totalUpdated = 0;
for (const [opType, hashes] of Object.entries(updates)) {
  const CHUNK = 500;
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const chunk = hashes.slice(i, i + CHUNK);
    await db`UPDATE transfers SET op_type = ${opType} WHERE hash = ANY(${chunk}) AND kind = 'MINT'`;
    totalUpdated += chunk.length;
  }
  console.log(`  → ${opType}: ${hashes.length} records updated`);
}
console.log(`\nTotal updated: ${totalUpdated} of ${uncovered.length}`);

const finalDist = await db`
  SELECT op_type, COUNT(*) AS n FROM transfers
  WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','PARTIAL')
  GROUP BY op_type ORDER BY n DESC
`;
console.log('\nFinal distribution:');
for (const r of finalDist) console.log(`  ${r.op_type}: ${r.n}`);

process.exit(0);
