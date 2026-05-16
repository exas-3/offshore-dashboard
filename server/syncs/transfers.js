import {
  fetchTransferLogs, fetchTxInputs, fetchFactoryTradeContext,
  getCompanyTradeTypes, getCompanyType, classifyTransfer,
  fetchSupplyAtBlock, DIRTY,
} from '../etherscan.js';
import {
  getLastBlock, setLastBlock, upsertTransfers,
  getDaysNeedingSupplyBackfill, getHoursNeedingSupplyBackfill, saveTokenInfoSnapshot,
} from '../../lib/index.js';
import { runBlockSync } from './_run.js';

const DIRTY_START = 15_190_000;
const ZERO_TX     = '0x0000000000000000000000000000000000000000';

export function syncTransfers() {
  return runBlockSync({
    name: 'DIRTY',
    getLast: getLastBlock,
    setLast: setLastBlock,
    fromStart: DIRTY_START,
    async processBatch(start, end) {
      const logs = await fetchTransferLogs(DIRTY, start, end);
      if (logs.length === 0) return 0;

      const mintHashes = [...new Set(
        logs.filter(l => l.fromAddr === ZERO_TX).map(l => l.hash.toLowerCase())
      )];
      const [txInputs, tradeCtx] = await Promise.all([
        fetchTxInputs(mintHashes).catch(() => new Map()),
        fetchFactoryTradeContext(start, end).catch(() => ({ companyMap: new Map(), fullTxs: new Set(), companyBlockMap: new Map(), d47Map: new Map() })),
      ]);
      const companyAddrs = [...new Set([...tradeCtx.companyBlockMap.keys()])];
      if (companyAddrs.length > 0) {
        await getCompanyTradeTypes(companyAddrs, tradeCtx.companyBlockMap).catch(() => {});
      }

      const rows = logs.map(t => {
        const classified = { ...t, rawValue: t.amount.toString(), ...classifyTransfer(t.fromAddr, t.toAddr, t.amount, txInputs.get(t.hash.toLowerCase())) };
        if (classified.kind === 'MINT' && classified.opType === 'PARTIAL') {
          const txh       = t.hash.toLowerCase();
          const d47OpType = tradeCtx.d47Map?.get(txh + ':' + (t.logIndex - 2));
          if (d47OpType) {
            classified.opType = d47OpType;
          } else {
            const company = tradeCtx.companyMap.get(txh + ':' + t.logIndex);
            if (company) {
              const compType = getCompanyType(company);
              if      (compType === 1) classified.opType = 'DRUG_DEAL';
              else if (compType === 2) classified.opType = 'ARMS_DEAL';
              else if (compType === 3) classified.opType = 'EXTORTION';
            }
          }
        }
        return classified;
      });
      await upsertTransfers(rows);
      return rows.length;
    },
  });
}

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
