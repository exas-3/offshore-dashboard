// Trade-start ingestion. Two paths:
//
//   1. **Live WebSocket** (preferred, when ALCHEMY_WS_URL is set): subscribes
//      to factory `TradeStarted` events; logs arrive in ~1 s after mining.
//      Each fired event resolves to a single company → batched into a 1-tick
//      window so a burst of starts maps to one storage-slot read batch.
//   2. **Periodic poll** (fallback, runs every 60 s): catches anything the
//      WS missed during reconnect blips. Same handler as the WS path.
//
// Both write idempotently to `companies` via upsertCompanies; double-delivery
// is harmless (COALESCE-on-trade_type preserves a successful read).

import { rpcPost } from '../etherscan/rpc-client.js';
import {
  getTradeStates,
  getCompanyTradeTypesFromStorage,
  fetchStartedCompanies,
} from '../etherscan.js';
import { FACTORY } from '../etherscan/constants.js';
import { E_TRADE_STARTED } from '../etherscan/factory-events.js';
import { getWsClient } from '../etherscan/ws-client.js';
import {
  upsertCompanies,
  getLastTradeStartBlock,
  setLastTradeStartBlock,
} from '../../lib/index.js';

let busy = false;

// 60 s safety-net cadence (was 10 s when this was the only path).
export const COMPANY_STARTS_INTERVAL_MS = 60_000;

// Resolve a set of started-company addresses → upsert with type + owner.
// Shared by both the WS handler and the periodic poll fallback.
async function resolveAndUpsert(startedMap, label) {
  if (startedMap.size === 0) return;
  const addrs = [...startedMap.keys()];
  const [states, typeMap] = await Promise.all([
    getTradeStates(addrs).catch(() => []),
    getCompanyTradeTypesFromStorage(addrs).catch(() => new Map()),
  ]);
  const rows = states.map(s => ({
    ...s,
    owner: startedMap.get(s.company.toLowerCase()) ?? s.owner ?? null,
    tradeType: typeMap.get(s.company.toLowerCase()) ?? null,
  })).filter(r => r.owner);
  if (rows.length) await upsertCompanies(rows);
  console.log(`[poller] company-starts (${label}): ${startedMap.size} started, ${rows.filter(r => r.tradeType).length} typed`);
}

// ── WS path ───────────────────────────────────────────────────────────────
// Coalesce a burst of TradeStarted logs in the same tick into one upsert
// batch — avoids spamming getTradeStates / storage reads per individual
// event. 200 ms flush window catches everything from the same block.
let wsBuffer = new Map();
let flushTimer = null;
function bufferStarted(companyAddr, playerAddr) {
  if (!wsBuffer.has(companyAddr)) wsBuffer.set(companyAddr, playerAddr);
  if (!flushTimer) {
    flushTimer = setTimeout(async () => {
      const batch = wsBuffer; wsBuffer = new Map(); flushTimer = null;
      try { await resolveAndUpsert(batch, 'ws'); } catch (err) {
        console.error('[poller] company-starts (ws) flush error:', err.message);
      }
    }, 200);
  }
}

export function startCompanyStartsWs() {
  const client = getWsClient();
  client.addSubscription({
    name: 'company-starts',
    filter: { address: FACTORY.toLowerCase(), topics: [E_TRADE_STARTED] },
    onLog: (log) => {
      const company = ('0x' + log.topics[1].slice(26)).toLowerCase();
      const player  = ('0x' + log.topics[2].slice(26)).toLowerCase();
      bufferStarted(company, player);
    },
  });
}

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
    await resolveAndUpsert(startedMap, 'poll');
  } catch (err) {
    console.error('[poller] company-starts (poll) error:', err.message);
  } finally {
    busy = false;
  }
}
