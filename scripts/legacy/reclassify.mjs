import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually
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

const { getDistinctMintHashes, getDistinctSpendHashes, batchUpdateMintOpTypes } = await import('../lib/index.js');
const { fetchTxInputs, FUNCTION_OP_TYPES } = await import('../server/etherscan.js');

// Selectors that classify as MINT ops
const MINT_OPS  = new Set(['SCRAP', 'EXTORTION']);
// Selectors that classify as SPEND ops
const SPEND_OPS = new Set(['BUY_ASSET', 'LEVEL_UP']);

async function reclassifyKind(hashes, kind, validOps) {
  console.log(`\nReclassifying ${kind}: ${hashes.length} unique hashes`);
  const CHUNK = 100;
  let updated = 0;
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const chunk    = hashes.slice(i, i + CHUNK);
    const inputMap = await fetchTxInputs(chunk).catch(() => new Map());
    const toUpdate = new Map();
    for (const [hash, input] of inputMap) {
      const sel     = input.slice(0, 10).toLowerCase();
      const knownOp = FUNCTION_OP_TYPES[sel];
      if (knownOp && validOps.has(knownOp)) toUpdate.set(hash, knownOp);
    }
    if (toUpdate.size > 0) {
      updated += await batchUpdateMintOpTypes(toUpdate, kind);
    }
    if ((i / CHUNK) % 10 === 0) process.stdout.write(`\r  [${i + chunk.length}/${hashes.length}] updated=${updated}   `);
    if (i + CHUNK < hashes.length) await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n  Done — updated ${updated} ${kind} rows`);
  return updated;
}

const mintHashes  = await getDistinctMintHashes();
const spendHashes = await getDistinctSpendHashes();

await reclassifyKind(mintHashes,  'MINT',  MINT_OPS);
await reclassifyKind(spendHashes, 'SPEND', SPEND_OPS);

process.exit(0);
