import {
  fetchLiquidationEvents, fetchFactoryTradeContext,
  fetchHitEvents,
  getCompanyTradeTypesFromStorage, getLatestBlock,
  FACTORY,
} from '../etherscan.js';
import { E_EXITED } from '../etherscan/factory-events.js';
import { getWsClient } from '../etherscan/ws-client.js';
import { bufferedFlush } from '../etherscan/buffered-flush.js';
import { logSyncError } from './log-throttle.js';
import { getCompanyOwners, getLastLiqBlock, setLastLiqBlock, upsertTransfers } from '../../lib/index.js';

export const LIQ_INTERVAL_MS = 60_000;
const LIQ_START              = 15_190_000;
const BATCH                  = 20_000;

let liqSyncing = false;

// Shared batch processor for a given block range. Both the polling path
// and the WS-driven flush funnel through here so the synthesized MINT
// rows are produced identically.
async function processLiquidationBatch(start, end) {
  const [liqs, tradeCtx, hitCtx] = await Promise.all([
    fetchLiquidationEvents(start, end).catch(() => []),
    fetchFactoryTradeContext(start, end).catch(() => ({ companyMap: new Map(), fullTxs: new Set(), companyBlockMap: new Map() })),
    fetchHitEvents(start, end).catch(() => ({ hits: [], byTx: new Map() })),
  ]);
  if (liqs.length === 0) return 0;
  // Skip E_EXITEDs that come from a hit — transfers.js already records the
  // victim's keep MINT with op_type=HIT_REFUND, so synthesizing a duplicate
  // bust row here would double-count.
  const beforeFilter = liqs.length;
  const liqsFiltered = liqs.filter(l => !hitCtx.byTx.has(l.hash));
  if (liqsFiltered.length !== beforeFilter) {
    console.log(`[poller] liquidations: filtered ${beforeFilter - liqsFiltered.length} hit-induced exits`);
  }
  if (liqsFiltered.length === 0) return 0;

  // Resolve trade type from the company's storage slots 4/5 at blockNum-1
  // (still inside the active trade window). Duration → op_type is
  // unambiguous (300/1800/5400 → EXTORTION/ARMS/DRUG). Mirrors the path
  // in syncs/transfers.js.
  const liqCompanyAddrs = [...new Set(liqsFiltered.map(l => l.companyAddr))];
  const typeMap = liqCompanyAddrs.length
    ? await getCompanyTradeTypesFromStorage(liqCompanyAddrs, tradeCtx.companyBlockMap).catch(() => new Map())
    : new Map();

  const missingPlayer = liqsFiltered.filter(l => !l.playerAddr).map(l => l.companyAddr);
  const ownerMap = missingPlayer.length > 0 ? await getCompanyOwners(missingPlayer) : new Map();

  const rows = liqsFiltered.map(l => {
    // Storage-slot duration is the canonical trade-type signal. If the RPC
    // read failed, leave the row as PARTIAL (transient) so the next sweep
    // / backfill can resolve it rather than guessing from amount.
    const opType = typeMap.get(l.companyAddr.toLowerCase()) ?? 'PARTIAL';
    const toAddr = l.playerAddr ?? ownerMap.get(l.companyAddr) ?? l.companyAddr;
    return {
      hash: l.hash, logIndex: l.logIndex, blockNum: l.blockNum,
      timestamp: l.timestamp, fromAddr: '0x0000000000000000000000000000000000000000',
      toAddr, rawValue: String(l.dirtyAmount), amount: l.dirtyAmount,
      kind: 'MINT', opType,
      // E_EXITED-without-payout is the definition of a busted op.
      result: 'busted',
    };
  });
  await upsertTransfers(rows);
  return rows.length;
}

// ── Polling path (safety net) ─────────────────────────────────────────────
export async function syncLiquidations() {
  if (liqSyncing) return;
  liqSyncing = true;
  try {
    const fromBlock   = Math.max(await getLastLiqBlock() + 1, LIQ_START);
    const latestBlock = await getLatestBlock();
    if (fromBlock > latestBlock) return;

    let total = 0;
    for (let start = fromBlock; start <= latestBlock; start += BATCH) {
      const end = Math.min(start + BATCH - 1, latestBlock);
      total += await processLiquidationBatch(start, end);
      await new Promise(r => setTimeout(r, 400));
    }

    await setLastLiqBlock(latestBlock);
    if (total > 0) console.log(`[poller] liquidations (poll) +${total} | block ${latestBlock}`);
  } catch (err) {
    logSyncError('liquidations (poll)', err);
  } finally {
    liqSyncing = false;
  }
}

// ── WS path ───────────────────────────────────────────────────────────────
// Subscribe to factory E_EXITED. Buffer blocks for 1.5 s, then flush
// through processLiquidationBatch over the affected block range. The
// batch helper itself re-fetches E_EXITED + E_PAYOUT via eth_getLogs to
// filter paid exits — we don't try to use the WS log payload directly.
const wsBuffer = bufferedFlush({
  label:   'poller] liquidations (ws)',
  flushMs: 1500,
  keyFn:   (b) => b, // de-dupe by block number
  onFlush: async (blocks) => {
    const start = Math.min(...blocks);
    const end   = Math.max(...blocks);
    const n = await processLiquidationBatch(start, end);
    if (n) console.log(`[poller] liquidations (ws) +${n} | blocks ${start}..${end}`);
  },
});

export function startLiquidationsWs() {
  const client = getWsClient();
  client.addSubscription({
    name: 'liquidations',
    filter: { address: FACTORY.toLowerCase(), topics: [E_EXITED] },
    onLog: (rawLog) => {
      try { wsBuffer.push(parseInt(rawLog.blockNumber, 16)); } catch {}
    },
  });
}
