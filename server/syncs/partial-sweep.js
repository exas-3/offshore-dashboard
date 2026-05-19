// Periodic recovery sweep for `transfers` rows still tagged op_type='PARTIAL'.
//
// For each batch (1000 rows ordered by block_num, starting at the cursor):
//   1. Group rows into 5000-block chunks.
//   2. Per chunk: fetchFactoryTradeContext → companyMap + companyBlockMap.
//   3. getCompanyTradeTypesFromStorage(companies, blockMap) reads slots 4/5
//      at blockNum-1 → duration → op_type.
//   4. UPDATE transfers per resolved (hash, log_index) with op_type + result.
//   5. Advance cursor past the max block in the batch.
//
// Cursor is stored in `meta.last_partial_sweep_block` so a restart doesn't
// re-walk previously-swept rows. When the cursor reaches the head of the
// PARTIAL set with nothing to resolve, the sweep sleeps until the next tick.

import { fetchFactoryTradeContext, getCompanyTradeTypesFromStorage } from '../etherscan.js';
import { getDb } from '../../lib/db/connection.js';
import {
  getLastPartialSweepBlock,
  setLastPartialSweepBlock,
  getCompanyTradeTypesFromDb,
} from '../../lib/index.js';

export const PARTIAL_SWEEP_INTERVAL_MS = 5 * 60_000;
const BATCH_LIMIT     = 1000;
const CHUNK_BLOCKS    = 5000;
const CHUNK_DELAY_MS  = 10_000;

let busy = false;

// PARTIAL rows come from two paths:
//   - liquidations.js synthesizes bust rows from TradeExited events
//   - transfers.js may write PARTIAL when DirtyPaid completion mints can't
//     be resolved at sync time
// Distinguish by checking whether the original PARTIAL came from a tx that
// also contained a DirtyPaid factory event. The fetchFactoryTradeContext
// payoutTxs set tells us; we approximate it here via the presence of a
// matching companyMap entry built from payoutLogs (logIndex = dirtyTransfer)
// vs exitedLogs (logIndex = exited event). The caller passes `fromPayout`
// based on which branch resolved the company.
function resolveResult(fromPayout) {
  return fromPayout ? 'completed' : 'busted';
}

// Retry on rate-limit errors with exponential backoff. Other errors throw
// immediately so they surface in the caller's log.
async function withRetry(label, fn) {
  const delays = [0, 3000, 8000, 20000];
  let lastErr;
  for (const wait of delays) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (!/rate limit/i.test(err.message)) throw err;
    }
  }
  throw lastErr;
}

async function chunkByBlockRange(rows) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const startBlock = Number(rows[i].block_num);
    const endBlock   = startBlock + CHUNK_BLOCKS - 1;
    let j = i;
    while (j < rows.length && Number(rows[j].block_num) <= endBlock) j++;
    out.push({ start: startBlock, end: endBlock, rows: rows.slice(i, j) });
    i = j;
  }
  return out;
}

export async function syncPartialSweep() {
  if (busy) return;
  busy = true;
  const db = getDb();
  let resolved = 0;
  let unresolved = 0;
  try {
    const cursor = await getLastPartialSweepBlock();
    const batch = await db`
      SELECT hash, log_index, block_num, amount FROM transfers
      WHERE kind = 'MINT' AND op_type = 'PARTIAL' AND block_num >= ${cursor}
      ORDER BY block_num LIMIT ${BATCH_LIMIT}`;
    if (batch.length === 0) {
      // Cursor caught up to the live head. Periodically rewind so new
      // PARTIAL rows added before the cursor still get a chance to resolve.
      const head = await db`
        SELECT MAX(block_num)::bigint AS hi FROM transfers
        WHERE kind = 'MINT' AND op_type = 'PARTIAL'`;
      const hi = Number(head[0]?.hi ?? 0);
      if (hi > 0 && hi < cursor) await setLastPartialSweepBlock(0);
      return;
    }

    const chunks = await chunkByBlockRange(batch);
    let maxBlockSeen = cursor;
    for (const c of chunks) {
      let ctx;
      try {
        ctx = await withRetry(`ctx ${c.start}..${c.end}`,
          () => fetchFactoryTradeContext(c.start, c.end));
      } catch (err) {
        console.warn(`[partial-sweep] factory ctx ${c.start}..${c.end} gave up: ${err.message}`);
        unresolved += c.rows.length;
        maxBlockSeen = Math.max(maxBlockSeen, c.end);
        continue;
      }
      const companies = [...ctx.companyBlockMap.keys()];
      let typeMap = new Map();
      if (companies.length) {
        try {
          typeMap = await withRetry(`slots ${c.start}..${c.end}`,
            () => getCompanyTradeTypesFromStorage(companies, ctx.companyBlockMap));
        } catch (err) {
          console.warn(`[partial-sweep] slots ${c.start}..${c.end} gave up: ${err.message}`);
        }
      }
      // DB fallback: pick up any companies the storage read couldn't resolve
      // (RPC rate-limited, missing block, expired trade window) from the
      // cached `trade_type` in the companies table.
      const missing = companies.filter(a => !typeMap.has(a));
      if (missing.length) {
        const dbMap = await getCompanyTradeTypesFromDb(missing).catch(() => new Map());
        for (const [a, t] of dbMap) typeMap.set(a, t);
      }

      const updates = { DRUG_DEAL: { completed: [], busted: [] },
                        ARMS_DEAL: { completed: [], busted: [] },
                        EXTORTION: { completed: [], busted: [] } };
      // Keys built from companyMap (DirtyPaid uses dirtyLogIdx, TradeExited
      // uses exited logIndex). Both formats live in companyMap so a single
      // lookup resolves both completion- and bust-origin PARTIALs.
      for (const r of c.rows) {
        const txh = r.hash.toLowerCase();
        const company = ctx.companyMap.get(txh + ':' + Number(r.log_index));
        const opType = company ? typeMap.get(company.toLowerCase()) : null;
        if (!opType) { unresolved++; continue; }
        // DirtyPaid in the tx → completion mint; otherwise it's a bust mint
        // synthesized from TradeExited. This replaces the old amount-based
        // check that broke on Season 2 progressive payouts.
        const result = resolveResult(ctx.payoutTxs?.has(txh));
        updates[opType][result].push({ hash: r.hash, log_index: Number(r.log_index) });
      }

      for (const [opType, buckets] of Object.entries(updates)) {
        for (const [result, items] of Object.entries(buckets)) {
          if (!items.length) continue;
          // Update by (hash, log_index) pairs to avoid touching unrelated rows.
          const hashes  = items.map(i => i.hash);
          const indices = items.map(i => i.log_index);
          const r = await db`
            UPDATE transfers SET op_type = ${opType}, result = ${result}
            WHERE kind = 'MINT' AND op_type = 'PARTIAL'
              AND hash      = ANY(${hashes})
              AND log_index = ANY(${indices})`;
          resolved += r.count;
        }
      }
      maxBlockSeen = Math.max(maxBlockSeen, c.end);
      await new Promise(r => setTimeout(r, CHUNK_DELAY_MS));
    }

    await setLastPartialSweepBlock(maxBlockSeen + 1);
    console.log(`[partial-sweep] resolved=${resolved}, unresolved=${unresolved}, cursor=${maxBlockSeen + 1}`);
  } catch (err) {
    console.error('[partial-sweep] error:', err.message);
  } finally {
    busy = false;
  }
}
