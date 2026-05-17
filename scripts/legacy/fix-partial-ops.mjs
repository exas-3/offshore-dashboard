// Reclassify PARTIAL transfers to DRUG_DEAL/ARMS_DEAL/EXTORTION.
// PARTIAL rows are left when tradeType() can't be resolved at index time
// (e.g. poller catch-up after restart, when blockNum-1 is outside the non-archive RPC window).
// Resolves company from idx_logs E_PAYOUT (syncTransfers path) or E_EXITED (syncLiquidations path).
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
const E_PAYOUT      = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502';
const E_EXITED      = '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff';
const SEL_TRADETYPE = '0x6fd47b44';
const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY;
const ETHERSCAN_URL = `https://api.etherscan.io/v2/api?chainid=4326&apikey=${ETHERSCAN_KEY}`;

if (!ETHERSCAN_KEY) { console.error('ETHERSCAN_KEY not set'); process.exit(1); }

// ── 1. Fetch PARTIAL rows ─────────────────────────────────────────────────────
const partialRows = await db`
  SELECT hash, log_index, block_num::int AS block_num
  FROM transfers
  WHERE kind = 'MINT' AND op_type = 'PARTIAL'
  ORDER BY block_num
`;
console.log(`PARTIAL rows: ${partialRows.length}`);
if (partialRows.length === 0) { console.log('Nothing to do.'); process.exit(0); }

// ── 2. Resolve company per (tx_hash, log_index) from idx_logs ─────────────────
// E_PAYOUT fires immediately after each DIRTY ERC20 mint (payoutLogIndex = dirtyLogIndex + 1).
// Using this exact mapping handles batch txs where multiple companies complete in one tx.
const companyMap  = new Map(); // "tx_hash:log_index" → company_addr
const blockNumMap = new Map(); // "tx_hash:log_index" → block_num

const hashes = [...new Set(partialRows.map(r => r.hash.toLowerCase()))];
const CHUNK = 2_000;
process.stdout.write('Resolving companies from idx_logs (E_PAYOUT + E_EXITED)...\n');
for (let i = 0; i < hashes.length; i += CHUNK) {
  const chunk = hashes.slice(i, i + CHUNK);
  const [payoutRows, exitedRows] = await Promise.all([
    // E_PAYOUT: dirtyLogIndex = payoutLogIndex - 1
    db`SELECT tx_hash, log_index::int AS payout_log_index,
              '0x' || RIGHT(topic1, 40) AS company, block_num::int AS block_num
       FROM idx_logs
       WHERE address = ${FACTORY} AND topic0 = ${E_PAYOUT} AND tx_hash = ANY(${chunk})`,
    // E_EXITED fallback for syncLiquidations PARTIAL rows (E_EXITED without E_PAYOUT)
    db`SELECT tx_hash, '0x' || RIGHT(topic1, 40) AS company, block_num::int AS block_num
       FROM idx_logs
       WHERE address = ${FACTORY} AND topic0 = ${E_EXITED} AND tx_hash = ANY(${chunk})`,
  ]);
  const payoutTxs = new Set(payoutRows.map(r => r.tx_hash.toLowerCase()));
  for (const r of payoutRows) {
    const txh = r.tx_hash.toLowerCase();
    const dirtyLogIdx = r.payout_log_index - 1;
    const key = txh + ':' + dirtyLogIdx;
    companyMap.set(key, r.company.toLowerCase());
    blockNumMap.set(key, r.block_num);
  }
  for (const r of exitedRows) {
    const txh = r.tx_hash.toLowerCase();
    if (!payoutTxs.has(txh)) {
      // For E_EXITED-only txs, we don't have a specific dirtyLogIndex
      // Store by txHash alone as fallback (these go through syncLiquidations)
      const key = txh + ':exited';
      if (!companyMap.has(key)) {
        companyMap.set(key, r.company.toLowerCase());
        blockNumMap.set(key, r.block_num);
      }
    }
  }
  process.stdout.write(`\r  ${Math.min(i + CHUNK, hashes.length)} / ${hashes.length}   `);
}
console.log(`\n  Resolved: ${companyMap.size} unique (tx:logIdx) → company mappings`);

// ── 3. Build unique (company, blockNum-1) pairs for archive eth_call ──────────
// For each PARTIAL row, resolve its specific company using the per-logIndex key.
// Falls back to the ':exited' key for syncLiquidations PARTIAL rows.
const callMap = new Map(); // "company:blockNum-1" → { company, blockTag }
const rowCompanyMap = new Map(); // "tx_hash:log_index" → company (for step 5)
const rowBlockMap   = new Map(); // "tx_hash:log_index" → block_num

for (const r of partialRows) {
  const txh = r.hash.toLowerCase();
  const li  = r.log_index;
  const key = txh + ':' + li;
  const company = companyMap.get(key) ?? companyMap.get(txh + ':exited');
  if (!company) continue;
  const bn = blockNumMap.get(key) ?? blockNumMap.get(txh + ':exited') ?? r.block_num;
  rowCompanyMap.set(key, company);
  rowBlockMap.set(key, bn);
  const callKey = company + ':' + (bn - 1);
  if (!callMap.has(callKey)) callMap.set(callKey, { company, blockTag: '0x' + (bn - 1).toString(16) });
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
console.log(`  type 3 (EXTORTION) : ${typeDist[3]}`);
console.log(`  type 0 (unknown)   : ${typeDist[0]}`);

// ── 5. Build update buckets ───────────────────────────────────────────────────
// Use per-row (tx_hash:log_index) → company mapping for correct multi-company tx handling.
const updates = { DRUG_DEAL: [], ARMS_DEAL: [], EXTORTION: [] };
let noCompany = 0;
let unknownType = 0;

for (const r of partialRows) {
  const key     = r.hash.toLowerCase() + ':' + r.log_index;
  const company = rowCompanyMap.get(key);
  if (!company) { noCompany++; continue; }
  const bn       = rowBlockMap.get(key) ?? r.block_num;
  const cacheKey = company + ':' + (bn - 1);
  const t = typeCache.get(cacheKey) ?? 0;
  if      (t === 1) updates.DRUG_DEAL.push({ hash: r.hash, logIndex: r.log_index });
  else if (t === 2) updates.ARMS_DEAL.push({ hash: r.hash, logIndex: r.log_index });
  else if (t === 3) updates.EXTORTION.push({ hash: r.hash, logIndex: r.log_index });
  else              unknownType++;
}

console.log(`\nReclassification plan:`);
console.log(`  → DRUG_DEAL  : ${updates.DRUG_DEAL.length}`);
console.log(`  → ARMS_DEAL  : ${updates.ARMS_DEAL.length}`);
console.log(`  → EXTORTION  : ${updates.EXTORTION.length}`);
console.log(`  No company   : ${noCompany}`);
console.log(`  Unknown type : ${unknownType} (stay PARTIAL)`);

// ── 6. Apply updates ──────────────────────────────────────────────────────────
const UPDATE_CHUNK = 500;
let totalUpdated = 0;

for (const [opType, rowList] of [
  ['DRUG_DEAL', updates.DRUG_DEAL],
  ['ARMS_DEAL', updates.ARMS_DEAL],
  ['EXTORTION', updates.EXTORTION],
]) {
  if (rowList.length === 0) continue;
  for (let i = 0; i < rowList.length; i += UPDATE_CHUNK) {
    const chunk = rowList.slice(i, i + UPDATE_CHUNK);
    const hashes    = chunk.map(r => r.hash);
    const logIndexes = chunk.map(r => r.logIndex);
    // Update by (hash, log_index) pair for precise per-row targeting
    await db`
      UPDATE transfers SET op_type = ${opType}
      WHERE (hash, log_index) IN (SELECT UNNEST(${hashes}::text[]), UNNEST(${logIndexes}::int[]))
        AND kind = 'MINT' AND op_type = 'PARTIAL'
    `;
    totalUpdated += chunk.length;
  }
  console.log(`Updated ${rowList.length} → ${opType}`);
}
console.log(`\nTotal updated: ${totalUpdated}`);

// ── 7. Final distribution ─────────────────────────────────────────────────────
const dist = await db`
  SELECT op_type, COUNT(*) AS n FROM transfers
  WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL','SCRAP')
  GROUP BY op_type ORDER BY n DESC
`;
console.log('\nFinal MINT distribution:');
for (const r of dist) console.log(`  ${r.op_type}: ${r.n}`);

process.exit(0);
