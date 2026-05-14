// Reclassify EXTORTION transfers with fractional DIRTY amounts (not 0/5/100/115/130).
// These were incorrectly classified via d47 bust status code instead of tradeType().
// Uses Etherscan V2 archive eth_call to get tradeType() at blockNum-1.
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

const FACTORY       = '0x619814a203ca441611cee02abf31986ca265dd35';
const E_EXITED      = '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff';
const SEL_TRADETYPE = '0x6fd47b44';
const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY;
const ETHERSCAN_URL = `https://api.etherscan.io/v2/api?chainid=4326&apikey=${ETHERSCAN_KEY}`;

if (!ETHERSCAN_KEY) { console.error('ETHERSCAN_KEY not set'); process.exit(1); }

// ── 1. Fetch bad rows ─────────────────────────────────────────────────────────
const badRows = await db`
  SELECT hash, log_index, block_num::int AS block_num
  FROM transfers
  WHERE kind = 'MINT' AND op_type = 'EXTORTION'
    AND amount::float NOT IN (0, 5, 100, 115, 130)
  ORDER BY block_num
`;
console.log(`Bad EXTORTION rows: ${badRows.length}`);
if (badRows.length === 0) { console.log('Nothing to do.'); process.exit(0); }

// ── 2. Resolve company per tx_hash from idx_logs ──────────────────────────────
const hashes = [...new Set(badRows.map(r => r.hash.toLowerCase()))];
const companyMap  = new Map(); // tx_hash → company_addr
const blockNumMap = new Map(); // tx_hash → block_num

const CHUNK = 2_000;
process.stdout.write('Resolving companies from idx_logs...\n');
for (let i = 0; i < hashes.length; i += CHUNK) {
  const chunk = hashes.slice(i, i + CHUNK);
  const rows = await db`
    SELECT tx_hash, '0x' || RIGHT(topic1, 40) AS company, block_num::int AS block_num
    FROM idx_logs
    WHERE address = ${FACTORY} AND topic0 = ${E_EXITED} AND tx_hash = ANY(${chunk})
  `;
  for (const r of rows) {
    const txh = r.tx_hash.toLowerCase();
    companyMap.set(txh, r.company.toLowerCase());
    blockNumMap.set(txh, r.block_num);
  }
  process.stdout.write(`\r  ${Math.min(i + CHUNK, hashes.length)} / ${hashes.length}   `);
}
console.log(`\n  Resolved: ${companyMap.size} / ${hashes.length} hashes`);

// ── 3. Build unique (company, blockNum-1) pairs for archive eth_call ──────────
// One company can run multiple trade types over time — use per-row blockNum.
// Deduplicate by (company + blockNum-1) key.
const callMap = new Map(); // "company:blockNum-1" → { company, blockTag }
for (const r of badRows) {
  const txh     = r.hash.toLowerCase();
  const company = companyMap.get(txh);
  if (!company) continue;
  const bn  = blockNumMap.get(txh) ?? r.block_num;
  const key = company + ':' + (bn - 1);
  if (!callMap.has(key)) callMap.set(key, { company, blockTag: '0x' + (bn - 1).toString(16) });
}

const calls = [...callMap.entries()];
console.log(`\nUnique (company, block-1) pairs: ${calls.length}`);
console.log('Fetching tradeType() via Etherscan archive...');

// ── 4. Etherscan eth_call in batches of 5 (rate limit ~5 req/s) ───────────────
const typeCache = new Map(); // "company:blockTag" → 0/1/2/3

async function ethCall(to, blockTag) {
  const url = `${ETHERSCAN_URL}&module=proxy&action=eth_call&to=${to}&data=${SEL_TRADETYPE}&tag=${blockTag}`;
  const res = await fetch(url);
  const json = await res.json();
  const hex = json?.result;
  if (!hex || hex === '0x') return 0;
  try { return Number(BigInt(hex)); } catch { return 0; }
}

const BATCH = 5;
let done = 0;
for (let i = 0; i < calls.length; i += BATCH) {
  const batch = calls.slice(i, i + BATCH);
  const results = await Promise.all(batch.map(([key, { company, blockTag }]) =>
    ethCall(company, blockTag).then(t => ({ key, t })).catch(() => ({ key, t: 0 }))
  ));
  for (const { key, t } of results) typeCache.set(key, t);
  done += batch.length;
  process.stdout.write(`\r  ${done} / ${calls.length}   `);
  if (i + BATCH < calls.length) await new Promise(r => setTimeout(r, 250));
}
console.log('\n');

const typeDist = { 1: 0, 2: 0, 3: 0, 0: 0 };
for (const t of typeCache.values()) typeDist[t] = (typeDist[t] ?? 0) + 1;
console.log(`  type 1 (DRUG_DEAL) : ${typeDist[1]}`);
console.log(`  type 2 (ARMS_DEAL) : ${typeDist[2]}`);
console.log(`  type 3 (EXTORTION) : ${typeDist[3]} (were already correct)`);
console.log(`  type 0 (unknown)   : ${typeDist[0]}`);

// ── 5. Build update buckets ───────────────────────────────────────────────────
const updates = { DRUG_DEAL: [], ARMS_DEAL: [], EXTORTION: [], PARTIAL: [] };
let noCompany = 0;

for (const r of badRows) {
  const txh     = r.hash.toLowerCase();
  const company = companyMap.get(txh);
  if (!company) { noCompany++; continue; }
  const bn       = blockNumMap.get(txh) ?? r.block_num;
  const cacheKey = company + ':' + (bn - 1);
  const t = typeCache.get(cacheKey) ?? 0;
  if      (t === 1) updates.DRUG_DEAL.push(r.hash);
  else if (t === 2) updates.ARMS_DEAL.push(r.hash);
  else if (t === 3) updates.EXTORTION.push(r.hash);   // already correct, skip
  else              updates.PARTIAL.push(r.hash);      // unknown → PARTIAL
}

console.log(`\nReclassification plan:`);
console.log(`  → DRUG_DEAL  : ${updates.DRUG_DEAL.length}`);
console.log(`  → ARMS_DEAL  : ${updates.ARMS_DEAL.length}`);
console.log(`  → EXTORTION  : ${updates.EXTORTION.length} (already correct, skip)`);
console.log(`  → PARTIAL    : ${updates.PARTIAL.length} (unknown type)`);
console.log(`  No company   : ${noCompany}`);

// ── 6. Apply updates ──────────────────────────────────────────────────────────
const UPDATE_CHUNK = 500;
let totalUpdated = 0;

for (const [opType, hashList] of [['DRUG_DEAL', updates.DRUG_DEAL], ['ARMS_DEAL', updates.ARMS_DEAL], ['PARTIAL', updates.PARTIAL]]) {
  if (hashList.length === 0) continue;
  for (let i = 0; i < hashList.length; i += UPDATE_CHUNK) {
    const chunk = hashList.slice(i, i + UPDATE_CHUNK);
    await db`
      UPDATE transfers SET op_type = ${opType}
      WHERE hash = ANY(${chunk}) AND kind = 'MINT' AND op_type = 'EXTORTION'
    `;
    totalUpdated += chunk.length;
  }
  console.log(`Updated ${hashList.length} → ${opType}`);
}
console.log(`\nTotal updated: ${totalUpdated}`);

// ── 7. Final distribution ─────────────────────────────────────────────────────
const dist = await db`
  SELECT op_type, COUNT(*) AS n FROM transfers
  WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL')
  GROUP BY op_type ORDER BY n DESC
`;
console.log('\nFinal distribution:');
for (const r of dist) console.log(`  ${r.op_type}: ${r.n}`);

process.exit(0);
