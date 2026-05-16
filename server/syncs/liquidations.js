import {
  fetchLiquidationEvents, fetchFactoryTradeContext,
  getCompanyTradeTypes, getCompanyType, getLatestBlock,
} from '../etherscan.js';
import { getCompanyOwners, getLastLiqBlock, setLastLiqBlock, upsertTransfers } from '../../lib/index.js';

export const LIQ_INTERVAL_MS = 60_000;
const LIQ_START              = 15_190_000;
const BATCH                  = 20_000;

let liqSyncing = false;

export async function syncLiquidations() {
  if (liqSyncing) return;
  liqSyncing = true;
  try {
    const fromBlock   = Math.max(await getLastLiqBlock() + 1, LIQ_START);
    const latestBlock = await getLatestBlock();
    if (fromBlock > latestBlock) return;

    let total = 0;
    for (let start = fromBlock; start <= latestBlock; start += BATCH) {
      const end  = Math.min(start + BATCH - 1, latestBlock);
      const [liqs, tradeCtx] = await Promise.all([
        fetchLiquidationEvents(start, end).catch(() => []),
        fetchFactoryTradeContext(start, end).catch(() => ({ companyMap: new Map(), fullTxs: new Set(), companyBlockMap: new Map(), d47Map: new Map() })),
      ]);
      if (liqs.length > 0) {
        const liqCompanyAddrs = [...new Set(liqs.map(l => l.companyAddr))];
        if (liqCompanyAddrs.length > 0) {
          await getCompanyTradeTypes(liqCompanyAddrs, tradeCtx.companyBlockMap).catch(() => {});
        }
        const missingPlayer = liqs.filter(l => !l.playerAddr).map(l => l.companyAddr);
        const ownerMap = missingPlayer.length > 0 ? await getCompanyOwners(missingPlayer) : new Map();

        const rows = liqs.map(l => {
          const compType = getCompanyType(l.companyAddr);
          const opType = compType === 1 ? 'DRUG_DEAL'
                       : compType === 2 ? 'ARMS_DEAL'
                       : compType === 3 ? 'EXTORTION'
                       : l.dirtyAmount > 0 ? 'PARTIAL' : 'EXTORTION';
          const toAddr = l.playerAddr ?? ownerMap.get(l.companyAddr) ?? l.companyAddr;
          return {
            hash: l.hash, logIndex: l.logIndex, blockNum: l.blockNum,
            timestamp: l.timestamp, fromAddr: '0x0000000000000000000000000000000000000000',
            toAddr, rawValue: String(l.dirtyAmount), amount: l.dirtyAmount,
            kind: 'MINT', opType,
          };
        });
        await upsertTransfers(rows);
        total += rows.length;
      }
      await new Promise(r => setTimeout(r, 400));
    }

    await setLastLiqBlock(latestBlock);
    if (total > 0) console.log(`[poller] liquidations +${total} | block ${latestBlock}`);
  } catch (err) {
    console.error('[poller] liquidation sync error:', err.message);
  } finally {
    liqSyncing = false;
  }
}
