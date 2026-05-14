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
const db = getDb();

const RPC     = process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.megaeth.com/rpc';
const FACTORY = '0x619814a203ca441611cee02abf31986ca265dd35';
const E_PAYOUT   = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502';
const E_COMPLETE = '0x55458b8d3210ff0a2d3612a4b3639021fd38d66d563562a98ca8b7d5e7930f70';
const TRADE_TYPE_SEL = '0x6fd47b44';

let rpcId = 1;
async function rpcBatch(calls) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(calls),
  });
  return await r.json();
}

// Step 1: get distinct company addresses from DirtyPaid events for covered transfers
console.log('Fetching distinct company addresses from idx_logs...');
const companies = await db`
  SELECT DISTINCT LOWER('0x' || RIGHT(il.topic1, 40)) AS addr
  FROM idx_logs il
  WHERE il.address = ${FACTORY} AND il.topic0 = ${E_PAYOUT}
    AND EXISTS (
      SELECT 1 FROM transfers t
      WHERE t.hash = il.tx_hash AND t.kind = 'MINT'
        AND t.op_type IN ('DRUG_DEAL','ARMS_DEAL','PARTIAL')
    )
`;
console.log(`  ${companies.length} distinct company addresses to classify`);

// Step 2: batch-call 0x6fd47b44 on each company
console.log('Fetching trade types via RPC...');
const typeMap = new Map();
const BATCH = 50;
for (let i = 0; i < companies.length; i += BATCH) {
  const chunk = companies.slice(i, i + BATCH);
  const calls = chunk.map(c => ({
    jsonrpc: '2.0', id: rpcId++, method: 'eth_call',
    params: [{ to: c.addr, data: TRADE_TYPE_SEL }, 'latest'],
  }));
  const results = await rpcBatch(calls);
  for (let j = 0; j < chunk.length; j++) {
    const res = results[j]?.result;
    const t = (res && res !== '0x') ? Number(BigInt(res)) : 0;
    typeMap.set(chunk[j].addr, t);
  }
  if ((i + BATCH) % 500 === 0) {
    process.stdout.write(`\r  [${i + BATCH}/${companies.length}] ...`);
  }
  await new Promise(r => setTimeout(r, 150));
}
console.log(`\n  Done. Type distribution:`);
const dist = {};
for (const t of typeMap.values()) dist[t] = (dist[t] || 0) + 1;
for (const [t, n] of Object.entries(dist).sort()) {
  const label = t === '0' ? 'inactive' : t === '1' ? 'DRUG_DEAL' : t === '2' ? 'ARMS_DEAL' : `unknown(${t})`;
  console.log(`    type=${t} (${label}): ${n} companies`);
}

// Step 3: create temp table with company→type mapping
console.log('\nBuilding company type lookup table...');
await db`DROP TABLE IF EXISTS _reclassify_types`;
await db`CREATE TEMP TABLE _reclassify_types (addr TEXT PRIMARY KEY, trade_type SMALLINT)`;
const rows = [...typeMap.entries()].map(([addr, t]) => ({ addr, t }));
// Bulk insert in chunks
for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  await db`
    INSERT INTO _reclassify_types ${db(chunk.map(r => ({ addr: r.addr, trade_type: r.t })))}
  `;
}
console.log(`  Inserted ${rows.length} rows`);

// Step 4: run the reclassification update
console.log('\nReclassifying transfers...');
const result = await db`
  UPDATE transfers t
  SET op_type = CASE
    WHEN EXISTS (
      SELECT 1 FROM idx_logs il
      WHERE il.tx_hash = t.hash
        AND il.address = ${FACTORY}
        AND il.topic0 = ${E_COMPLETE}
    ) THEN CASE ct.trade_type
        WHEN 1 THEN 'DRUG_DEAL'
        WHEN 2 THEN 'ARMS_DEAL'
        ELSE 'PARTIAL'
      END
    ELSE 'PARTIAL'
  END
  FROM (
    SELECT il.tx_hash, LOWER('0x' || RIGHT(il.topic1, 40)) AS company
    FROM idx_logs il
    WHERE il.address = ${FACTORY} AND il.topic0 = ${E_PAYOUT}
  ) dp
  JOIN _reclassify_types ct ON ct.addr = dp.company
  WHERE t.hash = dp.tx_hash
    AND t.kind = 'MINT'
    AND t.op_type IN ('DRUG_DEAL','ARMS_DEAL','PARTIAL')
`;
console.log(`  Updated ${result.count} transfers`);

// Step 5: show final distribution
console.log('\nFinal op_type distribution:');
const finalDist = await db`
  SELECT op_type, COUNT(*) AS n FROM transfers
  WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','PARTIAL')
  GROUP BY op_type ORDER BY n DESC
`;
for (const r of finalDist) console.log(`  ${r.op_type}: ${r.n}`);

await db`DROP TABLE IF EXISTS _reclassify_types`;
process.exit(0);
