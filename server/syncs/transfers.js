import {
  fetchTransferLogs, parseTransferLog, fetchTxInputs, fetchFactoryTradeContext,
  getCompanyTradeTypesFromStorage, classifyTransfer,
  fetchSupplyAtBlock, DIRTY, USDM, DEX_POOLS,
  TRADE_DURATIONS, resultFromAmount,
} from '../etherscan.js';
import { getWsClient } from '../etherscan/ws-client.js';
import { bufferedFlush } from '../etherscan/buffered-flush.js';
import {
  getLastBlock, setLastBlock, upsertTransfers,
  getDaysNeedingSupplyBackfill, getHoursNeedingSupplyBackfill, saveTokenInfoSnapshot,
} from '../../lib/index.js';
import { runBlockSync } from './_run.js';

const DIRTY_START    = 15_190_000;
const ZERO_TX        = '0x0000000000000000000000000000000000000000';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const POOLS_LC       = new Set(DEX_POOLS.map(p => p.toLowerCase()));

// Shared batch processor. Both the polling sync (eth_getLogs) and the WS
// path (buffered log delivery) funnel through here, so classification +
// LP detection + upsert behave identically.
async function processTransferBatch({ start, end, prefetched }) {
  const logs = prefetched ?? await fetchTransferLogs(DIRTY, start, end);
  if (logs.length === 0) return 0;

  const mintHashes = [...new Set(
    logs.filter(l => l.fromAddr === ZERO_TX).map(l => l.hash.toLowerCase())
  )];
  // Pull USDM Transfers in the same block range — net DIRTY/USDM delta
  // per user tells swap (opposite signs) apart from LP add/remove (same
  // signs).
  const [txInputs, tradeCtx, usdmLogs] = await Promise.all([
    fetchTxInputs(mintHashes).catch(() => new Map()),
    fetchFactoryTradeContext(start, end).catch(() => ({ companyMap: new Map(), fullTxs: new Set(), companyBlockMap: new Map(), d47Map: new Map() })),
    fetchTransferLogs(USDM, start, end).catch(() => []),
  ]);
  const usdmByTx = new Map();
  for (const u of usdmLogs) {
    const h = u.hash.toLowerCase();
    if (!usdmByTx.has(h)) usdmByTx.set(h, []);
    usdmByTx.get(h).push(u);
  }

  // Resolve trade types for every company that emitted a DirtyPaid /
  // TradeExited event in this range. We read slots 4/5 at blockNum-1 so
  // the company is still inside its active trade window. Duration →
  // op_type is unambiguous (300/1800/5400 → EXTORTION/ARMS/DRUG).
  const companyAddrs = [...tradeCtx.companyBlockMap.keys()];
  const typeMap = companyAddrs.length
    ? await getCompanyTradeTypesFromStorage(companyAddrs, tradeCtx.companyBlockMap).catch(() => new Map())
    : new Map();

  const rows = logs.map(t => {
    const classified = { ...t, rawValue: t.amount.toString(), ...classifyTransfer(t.fromAddr, t.toAddr, t.amount, txInputs.get(t.hash.toLowerCase())) };
    if (classified.kind === 'MINT' && classified.opType === 'PARTIAL') {
      const txh = t.hash.toLowerCase();
      const company = tradeCtx.companyMap.get(txh + ':' + t.logIndex);
      const resolved = company ? typeMap.get(company.toLowerCase()) : null;
      if (resolved) classified.opType = resolved;
    }
    // Outcome for game-op MINTs: completed payouts are exactly 100/115/130
    // DIRTY (location-dependent); anything else is a busted op with a
    // proportionate refund.
    if (classified.kind === 'MINT' && TRADE_DURATIONS[classified.opType] != null) {
      classified.result = resultFromAmount(classified.amount);
    }
    return classified;
  });

  // Post-pass: tell DEX swap apart from LP add/remove. For each row
  // currently tagged DEX_BUY / DEX_SELL, compute the user's net DIRTY +
  // USDM delta within the same tx; same signs → LP_ADD / LP_REMOVE;
  // opposite signs → genuine swap (keep tag).
  const dirtyByTx = new Map();
  for (const r of rows) {
    if (r.kind !== 'TRANSFER') continue;
    if (r.opType !== 'DEX_BUY' && r.opType !== 'DEX_SELL') continue;
    const h = r.hash.toLowerCase();
    if (!dirtyByTx.has(h)) dirtyByTx.set(h, []);
    dirtyByTx.get(h).push(r);
  }
  for (const r of rows) {
    if (r.kind !== 'TRANSFER') continue;
    if (r.opType !== 'DEX_BUY' && r.opType !== 'DEX_SELL') continue;
    const user = (r.opType === 'DEX_BUY' ? r.toAddr : r.fromAddr).toLowerCase();
    if (POOLS_LC.has(user)) continue; // user is another pool — inter-pool hop, skip
    const txh = r.hash.toLowerCase();
    let dDirty = 0;
    for (const d of dirtyByTx.get(txh) || []) {
      if (d.toAddr.toLowerCase()   === user) dDirty += Number(d.amount);
      if (d.fromAddr.toLowerCase() === user) dDirty -= Number(d.amount);
    }
    let dUsdm = 0;
    for (const u of usdmByTx.get(txh) || []) {
      if (u.toAddr.toLowerCase()   === user) dUsdm += Number(u.amount);
      if (u.fromAddr.toLowerCase() === user) dUsdm -= Number(u.amount);
    }
    if (dDirty > 0 && dUsdm > 0) r.opType = 'LP_REMOVE';
    else if (dDirty < 0 && dUsdm < 0) r.opType = 'LP_ADD';
    // else: opposite signs (or zero USDM delta) → genuine swap, leave as-is.
  }

  await upsertTransfers(rows);
  return rows.length;
}

// ── Polling path (safety net) ─────────────────────────────────────────────
// Cadence used to be 15 s; with the WS path live it can be slowed (the
// poller's TX_INTERVAL_MS knob controls this from server/poller.js).
export function syncTransfers() {
  return runBlockSync({
    name: 'DIRTY',
    getLast: getLastBlock,
    setLast: setLastBlock,
    fromStart: DIRTY_START,
    async processBatch(start, end) {
      return processTransferBatch({ start, end });
    },
  });
}

// ── WS path ───────────────────────────────────────────────────────────────
// Subscribe to live DIRTY Transfer events. Buffer them in a 1.5 s window
// and flush through processTransferBatch with the buffered logs as
// prefetched input — saves a redundant eth_getLogs call.
const wsBuffer = bufferedFlush({
  label:   'poller] DIRTY (ws)',
  flushMs: 1500,
  keyFn:   (l) => `${l.hash.toLowerCase()}:${l.logIndex}`,
  onFlush: async (logs) => {
    const blocks = logs.map(l => l.blockNum);
    const start  = Math.min(...blocks);
    const end    = Math.max(...blocks);
    const n = await processTransferBatch({ start, end, prefetched: logs });
    if (n) console.log(`[poller] DIRTY (ws): ${n} rows (blocks ${start}..${end})`);
  },
});

export function startTransfersWs() {
  const client = getWsClient();
  client.addSubscription({
    name: 'dirty-transfers',
    filter: { address: DIRTY.toLowerCase(), topics: [TRANSFER_TOPIC] },
    onLog: (rawLog) => {
      try {
        wsBuffer.push(parseTransferLog(rawLog));
      } catch (err) {
        console.warn('[poller] DIRTY (ws) parse failed:', err.message);
      }
    },
  });
}

// ── Supply history backfill (unchanged) ───────────────────────────────────
export async function backfillSupplyHistory() {
  let days, hours;
  try {
    days  = await getDaysNeedingSupplyBackfill();
    hours = await getHoursNeedingSupplyBackfill();
  } catch (err) {
    console.error('[poller] supply backfill skipped:', err.message);
    return;
  }
  const total = days.length + hours.length;
  if (total === 0) return;
  console.log(`[poller] backfilling supply history: ${days.length} days + ${hours.length} hours`);

  for (const { block_num, day_ts } of days) {
    try {
      const supply = await fetchSupplyAtBlock(block_num);
      await saveTokenInfoSnapshot(supply, null, day_ts);
      await new Promise(r => setTimeout(r, 80));
    } catch { /* block not in archive — skip */ }
  }
  for (const { block_num, hour_ts } of hours) {
    try {
      const supply = await fetchSupplyAtBlock(block_num);
      await saveTokenInfoSnapshot(supply, null, hour_ts);
      await new Promise(r => setTimeout(r, 80));
    } catch { /* block not in archive — skip */ }
  }
  console.log('[poller] supply history backfill done');
}
