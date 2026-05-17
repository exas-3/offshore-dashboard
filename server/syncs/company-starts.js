// Light, event-driven trade_type refresh.
//
// Every 10 s this fetches factory `TradeStarted` events (topic E_TRADE_STARTED)
// since the last block we processed, collects the set of companies whose
// trade just started, and reads slots 4 / 5 on each to resolve the new trade
// type. The light sync is the fast path for keeping `companies.trade_type`
// fresh; the full `syncCompanies` continues to run on its 2-min cadence for
// new-company discovery and ownership refresh.

import { rpcPost } from '../etherscan/rpc-client.js';
import {
  getTradeStates,
  getCompanyTradeTypesFromStorage,
  fetchStartedCompanies,
} from '../etherscan.js';
import {
  upsertCompanies,
  getLastTradeStartBlock,
  setLastTradeStartBlock,
} from '../../lib/index.js';

let busy = false;

export const COMPANY_STARTS_INTERVAL_MS = 10_000;

export async function syncCompanyStarts() {
  if (busy) return;
  busy = true;
  try {
    const tip = parseInt(await rpcPost('eth_blockNumber', []), 16);
    const lastSeen = await getLastTradeStartBlock();
    const fromBlock = lastSeen ? lastSeen + 1 : Math.max(1, tip - 300);
    if (fromBlock > tip) return;

    const startedMap = await fetchStartedCompanies(fromBlock, tip);
    await setLastTradeStartBlock(tip);
    if (startedMap.size === 0) return;

    const addrs = [...startedMap.keys()];
    const [states, typeMap] = await Promise.all([
      getTradeStates(addrs).catch(() => []),
      getCompanyTradeTypesFromStorage(addrs).catch(() => new Map()),
    ]);
    // Owner comes from topic2 of the TradeStarted event (== player == owner).
    // trade_type is from the storage read; the upsert COALESCEs so a clean
    // non-null read overwrites stale rows.
    const rows = states.map(s => ({
      ...s,
      owner: startedMap.get(s.company.toLowerCase()) ?? s.owner ?? null,
      tradeType: typeMap.get(s.company.toLowerCase()) ?? null,
    })).filter(r => r.owner); // safety: skip rows we can't owner-attribute
    if (rows.length) await upsertCompanies(rows);
    console.log(`[poller] company-starts: ${startedMap.size} started, ${rows.filter(r => r.tradeType).length} typed`);
  } catch (err) {
    console.error('[poller] company-starts error:', err.message);
  } finally {
    busy = false;
  }
}
