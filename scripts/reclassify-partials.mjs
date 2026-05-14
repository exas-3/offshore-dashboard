// Reclassify PARTIAL transfers to DRUG_DEAL or ARMS_DEAL using:
//   1. idx_logs (factory DirtyPaid events) for company address lookup — no RPC needed
//   2. RPC eth_call 0x6fd47b44 for company trade type
//
// PARTIAL records already passed the extort() selector check in the poller,
// so they are ARMS_DEAL or DRUG_DEAL completions where the type lookup failed.
// Skips records for destroyed companies (type=0) — those need indexer backfill.
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

const { getDb }                                        = await import('../lib/index.js');
const { getCompanyTradeTypes, _companyTypeCache }      = await import('../server/etherscan.js');
const db = getDb();

const FACTORY = '0x619814a203ca441611cee02abf31986ca265dd35';
const E_PAYOUT = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502';

// ── 1. Fetch all PARTIAL records ──────────────────────────────────────────────
const partials = await db`
  SELECT hash, block_num FROM transfers
  WHERE kind = 'MINT' AND op_type = 'PARTIAL'
  ORDER BY block_num
`;
console.log(`PARTIAL records: ${partials.length}`);
if (partials.length === 0) { console.log('Nothing to do.'); process.exit(0); }

const [idxStateRow] = await db`SELECT value FROM idx_state WHERE key = 'head'`;
const idxHead = parseInt(idxStateRow?.value ?? '0');
console.log(`idx_logs head: block ${idxHead}`);

const inIdx  = partials.filter(r => Number(r.block_num) <= idxHead);
const beyond = partials.filter(r => Number(r.block_num) >  idxHead);
console.log(`  In indexed blocks : ${inIdx.length}`);
console.log(`  Beyond idx head   : ${beyond.length} (will stay PARTIAL until indexer catches up)\n`);

if (inIdx.length === 0) { console.log('No indexed-block PARTIALs to fix.'); process.exit(0); }

// ── 2. Resolve company addresses from idx_logs ────────────────────────────────
const hashes = inIdx.map(r => r.hash.toLowerCase());
const companyMap = new Map(); // tx_hash → company_addr

const HASH_CHUNK = 2_000;
process.stdout.write('Looking up company addresses from idx_logs...\n');
for (let i = 0; i < hashes.length; i += HASH_CHUNK) {
  const chunk = hashes.slice(i, i + HASH_CHUNK);
  const rows = await db`
    SELECT tx_hash, '0x' || RIGHT(topic1, 40) AS company
    FROM idx_logs
    WHERE address = ${FACTORY}
      AND topic0  = ${E_PAYOUT}
      AND tx_hash = ANY(${chunk})
  `;
  for (const r of rows) companyMap.set(r.tx_hash.toLowerCase(), r.company.toLowerCase());
  process.stdout.write(`\r  ${Math.min(i + HASH_CHUNK, hashes.length)} / ${hashes.length}   `);
}
console.log(`\n  Found company addresses: ${companyMap.size} of ${hashes.length} hashes`);

// ── 3. Fetch trade types for unique companies ─────────────────────────────────
const uniqueCompanies = [...new Set(companyMap.values())];
console.log(`\nUnique company addresses: ${uniqueCompanies.length}`);
console.log('Fetching trade types via RPC (0x6fd47b44)...');
await getCompanyTradeTypes(uniqueCompanies);

const typeCount = { 1: 0, 2: 0, 0: 0 };
for (const addr of uniqueCompanies) typeCount[_companyTypeCache.get(addr) ?? 0]++;
console.log(`  type 1 (DRUG_DEAL) : ${typeCount[1]} companies`);
console.log(`  type 2 (ARMS_DEAL) : ${typeCount[2]} companies`);
console.log(`  type 0 (destroyed) : ${typeCount[0]} companies`);

// ── 4. Build update buckets ───────────────────────────────────────────────────
const updates = { DRUG_DEAL: [], ARMS_DEAL: [] };
let noCompany = 0, destroyed = 0;

for (const row of inIdx) {
  const txh     = row.hash.toLowerCase();
  const company = companyMap.get(txh);
  if (!company)               { noCompany++; continue; }
  const t = _companyTypeCache.get(company) ?? 0;
  if      (t === 1)           updates.DRUG_DEAL.push(row.hash);
  else if (t === 2)           updates.ARMS_DEAL.push(row.hash);
  else                        { destroyed++; }
}

console.log(`\nReclassification plan:`);
console.log(`  → DRUG_DEAL : ${updates.DRUG_DEAL.length}`);
console.log(`  → ARMS_DEAL : ${updates.ARMS_DEAL.length}`);
console.log(`  Skipped (no DirtyPaid in idx_logs) : ${noCompany}`);
console.log(`  Skipped (company destroyed, type=0): ${destroyed}`);

// ── 5. Apply updates ──────────────────────────────────────────────────────────
const CHUNK = 500;
let totalUpdated = 0;

for (const [opType, hashList] of Object.entries(updates)) {
  for (let i = 0; i < hashList.length; i += CHUNK) {
    const chunk = hashList.slice(i, i + CHUNK);
    await db`
      UPDATE transfers SET op_type = ${opType}
      WHERE hash = ANY(${chunk}) AND kind = 'MINT' AND op_type = 'PARTIAL'
    `;
    totalUpdated += chunk.length;
  }
}
console.log(`\nTotal updated: ${totalUpdated}`);

// ── 6. Final distribution ─────────────────────────────────────────────────────
const dist = await db`
  SELECT op_type, COUNT(*) AS n FROM transfers
  WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL')
  GROUP BY op_type ORDER BY n DESC
`;
console.log('\nFinal distribution:');
for (const r of dist) console.log(`  ${r.op_type}: ${r.n}`);

process.exit(0);
