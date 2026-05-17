import {
  fetchLiquidationEvents, fetchFactoryTradeContext,
  getCompanyTradeTypes, getCompanyType, getLatestBlock,
  FACTORY,
} from '../etherscan.js';
import { E_EXITED } from '../etherscan/factory-events.js';
import { getWsClient } from '../etherscan/ws-client.js';
import { getCompanyOwners, getLastLiqBlock, setLastLiqBlock, upsertTransfers } from '../../lib/index.js';

export const LIQ_INTERVAL_MS = 60_000;
const LIQ_START              = 15_190_000;
const BATCH                  = 20_000;

let liqSyncing = false;

// Shared batch processor for a given block range. Both the polling path
// and the WS-driven flush funnel through here so the synthesized MINT
// rows are produced identically.
async function processLiquidationBatch(start, end) {
  const [liqs, tradeCtx] = await Promise.all([
    fetchLiquidationEvents(start, end).catch(() => []),
    fetchFactoryTradeContext(start, end).catch(() => ({ companyMap: new Map(), fullTxs: new Set(), companyBlockMap: new Map(), d47Map: new Map(), d47TxMap: new Map() })),
  ]);
  if (liqs.length === 0) return 0;

  const liqCompanyAddrs = [...new Set(liqs.map(l => l.companyAddr))];
  if (liqCompanyAddrs.length > 0) {
    await getCompanyTradeTypes(liqCompanyAddrs, tradeCtx.companyBlockMap).catch(() => {});
  }
  const missingPlayer = liqs.filter(l => !l.playerAddr).map(l => l.companyAddr);
  const ownerMap = missingPlayer.length > 0 ? await getCompanyOwners(missingPlayer) : new Map();

  const rows = liqs.map(l => {
    // D47 (OpResult) event fires in every bust tx and carries the trade
    // type definitively. Prefer that over the company-type selector, which
    // returns 0 for extortion companies and so mis-tags those busts.
    const d47OpType = tradeCtx.d47TxMap?.get(l.hash);
    const compType  = getCompanyType(l.companyAddr);
    const opType = d47OpType
                ?? (compType === 1 ? 'DRUG_DEAL'
                  : compType === 2 ? 'ARMS_DEAL'
                  : compType === 3 ? 'EXTORTION'
                  : l.dirtyAmount > 0 ? 'PARTIAL' : 'EXTORTION');
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
    console.error('[poller] liquidations (poll) error:', err.message);
  } finally {
    liqSyncing = false;
  }
}

// ── WS path ───────────────────────────────────────────────────────────────
// Subscribe to factory E_EXITED. Buffer blocks for 1.5 s, then flush
// through processLiquidationBatch over the affected block range. The
// batch helper itself re-fetches E_EXITED + E_PAYOUT via eth_getLogs to
// filter paid exits — we don't try to use the WS log payload directly.

let wsBlocks = new Set();
let wsFlushTimer = null;
const WS_FLUSH_MS = 1500;

async function flushWsBuffer() {
  const blocks = wsBlocks; wsBlocks = new Set(); wsFlushTimer = null;
  if (blocks.size === 0) return;
  const arr   = [...blocks];
  const start = Math.min(...arr);
  const end   = Math.max(...arr);
  try {
    const n = await processLiquidationBatch(start, end);
    if (n) console.log(`[poller] liquidations (ws) +${n} | blocks ${start}..${end}`);
  } catch (err) {
    console.error('[poller] liquidations (ws) flush error:', err.message);
  }
}

export function startLiquidationsWs() {
  const client = getWsClient();
  client.addSubscription({
    name: 'liquidations',
    filter: { address: FACTORY.toLowerCase(), topics: [E_EXITED] },
    onLog: (rawLog) => {
      try { wsBlocks.add(parseInt(rawLog.blockNumber, 16)); } catch { return; }
      if (!wsFlushTimer) {
        wsFlushTimer = setTimeout(() => { flushWsBuffer().catch(() => {}); }, WS_FLUSH_MS);
      }
    },
  });
}
