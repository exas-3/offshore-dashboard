// One-shot backfill: retag every MINT row currently tagged 'PARTIAL' to its
// real op_type (DRUG_DEAL / ARMS_DEAL / EXTORTION) and set the `result`
// column on any DRUG/ARMS/EXTORTION MINT that's still NULL.
//
// Source of truth: factory D47 (OpResult) event word0 → 750=DRUG / 250=ARMS
// / 80=EXTORTION. Each game-op tx emits exactly one D47, so the mapping is
// unambiguous.
//
// Run locally:
//   node --env-file=.env scripts/reclassify-partials-v2.mjs

import { getDb } from '../lib/db/connection.js';
import { rpcPost } from '../server/etherscan/rpc-client.js';
import { FACTORY } from '../server/etherscan/constants.js';

const FACTORY_ADDR = FACTORY.toLowerCase();
const E_D47        = '0xd47648dbe74844d41eea0e3e6bf1d3f6f03cd31691e10e6edc7376d52b934dbd';

// Map D47 word0 → op_type (same mapping as fetchFactoryTradeContext).
function d47TypeFromLog(log) {
  const data = (log.data ?? '0x').slice(2);
  // word0 spans hex chars [60..64) — the lowest 2 bytes of the first 32-byte word.
  const word0 = parseInt(data.slice(60, 64), 16);
  return word0 === 750 ? 'DRUG_DEAL'
       : word0 === 250 ? 'ARMS_DEAL'
       : word0 === 80  ? 'EXTORTION'
       : null;
}

function resultFromAmount(amount) {
  const a = Number(amount);
  return (a === 100 || a === 115 || a === 130) ? 'completed' : 'busted';
}

async function fetchD47MapOnce(fromBlock, toBlock) {
  const logs = await rpcPost('eth_getLogs', [{
    address: FACTORY_ADDR,
    topics:  [E_D47],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
  }]);
  const map = new Map();
  for (const l of logs ?? []) {
    const opType = d47TypeFromLog(l);
    if (!opType) continue;
    const txh = l.transactionHash.toLowerCase();
    if (!map.has(txh)) map.set(txh, opType);
  }
  return map;
}

// Retry-with-backoff wrapper. Rate-limit responses are the most common
// transient failure here; back off generously and the run finishes cleanly.
async function fetchD47Map(fromBlock, toBlock) {
  const delays = [0, 1500, 3500, 8000];
  let lastErr;
  for (const wait of delays) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try {
      return await fetchD47MapOnce(fromBlock, toBlock);
    } catch (err) {
      lastErr = err;
      if (!/rate limit/i.test(err.message)) throw err;
    }
  }
  throw lastErr;
}

async function run() {
  const db = getDb();

  // ── Phase A: PARTIAL → real op_type ─────────────────────────────────────
  const partials = await db`
    SELECT hash, block_num, amount FROM transfers
    WHERE kind = 'MINT' AND op_type = 'PARTIAL'
    ORDER BY block_num`;
  console.log(`[v2-backfill] ${partials.length} PARTIAL rows to resolve`);

  if (partials.length === 0) {
    console.log('  nothing to do for PARTIAL.');
  } else {
    const minBlock = Number(partials[0].block_num);
    const maxBlock = Number(partials[partials.length - 1].block_num);
    console.log(`  block range: ${minBlock} .. ${maxBlock}`);

    // Scan in 5000-block chunks. MegaETH eth_getLogs comfortably handles this
    // size; 500 ms between calls keeps us under the public-RPC rate limit.
    const SPAN = 5000;
    const allD47 = new Map();
    const failed = [];
    for (let from = minBlock; from <= maxBlock; from += SPAN) {
      const to = Math.min(from + SPAN - 1, maxBlock);
      try {
        const m = await fetchD47Map(from, to);
        for (const [k, v] of m) allD47.set(k, v);
        process.stdout.write(`\r  scanned ${from}..${to}  cumulative D47 tx: ${allD47.size}    `);
      } catch (err) {
        failed.push([from, to]);
        console.warn(`\n  [warn] block range ${from}..${to} failed after retries: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    console.log('');
    if (failed.length) console.warn(`  ${failed.length} ranges failed permanently`);

    // Group by op_type then batch update.
    const buckets = { DRUG_DEAL: [], ARMS_DEAL: [], EXTORTION: [] };
    const resultMap = new Map(); // hash → result
    let unresolved = 0;
    for (const row of partials) {
      const op = allD47.get(row.hash.toLowerCase());
      if (!op) { unresolved++; continue; }
      buckets[op].push(row.hash);
      resultMap.set(row.hash.toLowerCase(), resultFromAmount(row.amount));
    }
    console.log(`  resolved: DRUG=${buckets.DRUG_DEAL.length} ARMS=${buckets.ARMS_DEAL.length} EXTORTION=${buckets.EXTORTION.length}`);
    console.log(`  unresolved (no D47 in range): ${unresolved}`);

    const CHUNK = 500;
    let updatedA = 0;
    for (const [opType, hashes] of Object.entries(buckets)) {
      for (let i = 0; i < hashes.length; i += CHUNK) {
        const chunk = hashes.slice(i, i + CHUNK);
        const completed = chunk.filter(h => resultMap.get(h.toLowerCase()) === 'completed');
        const busted    = chunk.filter(h => resultMap.get(h.toLowerCase()) === 'busted');
        if (completed.length) {
          const r = await db`
            UPDATE transfers
            SET op_type = ${opType}, result = 'completed'
            WHERE hash = ANY(${completed}) AND kind = 'MINT' AND op_type = 'PARTIAL'`;
          updatedA += r.count;
        }
        if (busted.length) {
          const r = await db`
            UPDATE transfers
            SET op_type = ${opType}, result = 'busted'
            WHERE hash = ANY(${busted}) AND kind = 'MINT' AND op_type = 'PARTIAL'`;
          updatedA += r.count;
        }
      }
    }
    console.log(`[v2-backfill] Phase A updated ${updatedA} rows`);
  }

  // ── Phase B: backfill NULL result on existing DRUG/ARMS/EXTORTION MINTs ─
  const nullResultBefore = await db`
    SELECT COUNT(*)::int AS n FROM transfers
    WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION') AND result IS NULL`;
  console.log(`[v2-backfill] ${nullResultBefore[0].n} non-PARTIAL MINTs with NULL result`);

  const phaseB = await db`
    UPDATE transfers
    SET result = CASE WHEN amount IN (100, 115, 130) THEN 'completed' ELSE 'busted' END
    WHERE kind = 'MINT'
      AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION')
      AND result IS NULL`;
  console.log(`[v2-backfill] Phase B updated ${phaseB.count} rows`);

  // ── Final state ─────────────────────────────────────────────────────────
  const dist = await db`
    SELECT op_type, COUNT(*)::int AS n FROM transfers
    WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL','SCRAP')
    GROUP BY op_type ORDER BY n DESC`;
  console.log('\nFinal MINT distribution:');
  for (const r of dist) console.log(`  ${r.op_type.padEnd(12)} ${r.n.toLocaleString()}`);

  const remainingNull = await db`
    SELECT COUNT(*)::int AS n FROM transfers
    WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION') AND result IS NULL`;
  console.log(`\nMINTs still NULL result: ${remainingNull[0].n}`);

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
