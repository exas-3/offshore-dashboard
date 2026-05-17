// One-shot: walk `transfers` rows currently tagged DEX_BUY / DEX_SELL and
// retag any whose net DIRTY + USDM delta for the user share the same sign
// — those are LP add / remove, not real swaps.
//
// Net-delta heuristic survives router intermediaries: regardless of how
// the tokens hop, the user's balance change is canonical.

import { getDb } from '../lib/db/connection.js';
import { rpcPost } from '../server/etherscan/rpc-client.js';
import { USDM, DEX_POOLS } from '../server/etherscan/constants.js';

const USDM_LC = USDM.toLowerCase();
const POOLS_LC = new Set(DEX_POOLS.map(p => p.toLowerCase()));
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const CHUNK_BLOCKS = 5000;
const CHUNK_DELAY_MS = 500;

async function withRetry(fn) {
  const delays = [0, 1500, 4000, 9000];
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

async function fetchUsdmDeltas(fromBlock, toBlock) {
  // Returns Map<txHash, Map<user, signedAmount>>
  const logs = await withRetry(() => rpcPost('eth_getLogs', [{
    address: USDM_LC,
    topics:  [TRANSFER_TOPIC],
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock:   '0x' + toBlock.toString(16),
  }]));
  const out = new Map();
  for (const l of logs ?? []) {
    const txh  = l.transactionHash.toLowerCase();
    const from = ('0x' + l.topics[1].slice(26)).toLowerCase();
    const to   = ('0x' + l.topics[2].slice(26)).toLowerCase();
    const amt  = Number(BigInt(l.data) / 10n ** 6n) / 1e12; // USDM has 18 decimals; scale to "units"
    if (!out.has(txh)) out.set(txh, new Map());
    const tm = out.get(txh);
    tm.set(from, (tm.get(from) ?? 0) - amt);
    tm.set(to,   (tm.get(to)   ?? 0) + amt);
  }
  return out;
}

async function run() {
  const db = getDb();

  // 1. Pull every DEX_BUY/SELL row keyed by block range.
  const rows = await db`
    SELECT hash, log_index, block_num, from_addr, to_addr, amount, op_type
    FROM transfers
    WHERE kind = 'TRANSFER' AND op_type IN ('DEX_BUY','DEX_SELL')
    ORDER BY block_num`;
  console.log(`[lp-backfill] inspecting ${rows.length} DEX_BUY/SELL rows`);
  if (!rows.length) { console.log('nothing to do'); process.exit(0); }

  // 2. For each row, identify the user (toAddr for BUY, fromAddr for SELL).
  //    Net DIRTY delta per user comes from the transfers table itself.
  const userOf  = (r) => (r.op_type === 'DEX_BUY' ? r.to_addr : r.from_addr).toLowerCase();
  const byBlock = new Map();
  for (const r of rows) {
    const b = Math.floor(Number(r.block_num) / CHUNK_BLOCKS) * CHUNK_BLOCKS;
    if (!byBlock.has(b)) byBlock.set(b, []);
    byBlock.get(b).push(r);
  }

  const updates = { LP_ADD: [], LP_REMOVE: [] };
  let inspected = 0;
  let unresolved = 0;
  for (const [chunkStart, chunkRows] of byBlock) {
    const chunkEnd = chunkStart + CHUNK_BLOCKS - 1;
    let usdmMap;
    try {
      usdmMap = await fetchUsdmDeltas(chunkStart, chunkEnd);
    } catch (err) {
      console.warn(`[lp-backfill] chunk ${chunkStart}..${chunkEnd} failed: ${err.message}`);
      unresolved += chunkRows.length;
      continue;
    }

    // Per-tx DIRTY delta — sum from the chunk's row set per (tx, user).
    // Each TRANSFER row in transfers has amount+from+to; we accumulate.
    const txHashes = [...new Set(chunkRows.map(r => r.hash.toLowerCase()))];
    const dirtyRows = await db`
      SELECT hash, from_addr, to_addr, amount FROM transfers
      WHERE kind = 'TRANSFER' AND hash = ANY(${txHashes})`;
    const dirtyByTx = new Map();
    for (const d of dirtyRows) {
      const h = d.hash.toLowerCase();
      if (!dirtyByTx.has(h)) dirtyByTx.set(h, new Map());
      const m = dirtyByTx.get(h);
      const f = d.from_addr.toLowerCase(), t = d.to_addr.toLowerCase();
      const a = Number(d.amount);
      m.set(f, (m.get(f) ?? 0) - a);
      m.set(t, (m.get(t) ?? 0) + a);
    }

    for (const r of chunkRows) {
      inspected++;
      const user = userOf(r);
      if (POOLS_LC.has(user)) continue; // user is another pool — inter-pool hop, skip
      const dDirty = dirtyByTx.get(r.hash.toLowerCase())?.get(user) ?? 0;
      const dUsdm  = usdmMap.get(r.hash.toLowerCase())?.get(user) ?? 0;
      if (dDirty > 0 && dUsdm > 0)      updates.LP_REMOVE.push({ hash: r.hash, log_index: Number(r.log_index) });
      else if (dDirty < 0 && dUsdm < 0) updates.LP_ADD.push   ({ hash: r.hash, log_index: Number(r.log_index) });
    }

    process.stdout.write(`\r  inspected ${inspected}/${rows.length}  LP_ADD=${updates.LP_ADD.length} LP_REMOVE=${updates.LP_REMOVE.length}    `);
    await new Promise(r => setTimeout(r, CHUNK_DELAY_MS));
  }
  console.log('');
  console.log(`[lp-backfill] unresolved chunks (rate-limited): ${unresolved}`);

  // 3. Apply updates.
  let updated = 0;
  const CHUNK = 500;
  for (const [opType, items] of Object.entries(updates)) {
    for (let i = 0; i < items.length; i += CHUNK) {
      const slice = items.slice(i, i + CHUNK);
      const hashes  = slice.map(s => s.hash);
      const indices = slice.map(s => s.log_index);
      const r = await db`
        UPDATE transfers SET op_type = ${opType}
        WHERE kind = 'TRANSFER' AND op_type IN ('DEX_BUY','DEX_SELL')
          AND hash      = ANY(${hashes})
          AND log_index = ANY(${indices})`;
      updated += r.count;
    }
  }
  console.log(`[lp-backfill] retagged ${updated} rows`);

  const dist = await db`
    SELECT op_type, COUNT(*)::int AS n FROM transfers
    WHERE kind = 'TRANSFER' AND op_type IN ('DEX_BUY','DEX_SELL','LP_ADD','LP_REMOVE','TRANSFER')
    GROUP BY op_type ORDER BY n DESC`;
  console.log('\nFinal TRANSFER distribution:');
  for (const r of dist) console.log(`  ${r.op_type.padEnd(12)} ${r.n.toLocaleString()}`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
