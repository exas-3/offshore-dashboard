import { fetchTransferLogs, parseTransferLog, INFLUENCE } from '../etherscan.js';
import { getWsClient } from '../etherscan/ws-client.js';
import { getLastInfluenceBlock, setLastInfluenceBlock, upsertInfluenceTransfers } from '../../lib/index.js';
import { runBlockSync } from './_run.js';

const INFLUENCE_START  = 15_194_000;
const TRANSFER_TOPIC   = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ── Polling path (safety net) ─────────────────────────────────────────────
export function syncInfluence() {
  return runBlockSync({
    name: 'influence',
    getLast: getLastInfluenceBlock,
    setLast: setLastInfluenceBlock,
    fromStart: INFLUENCE_START,
    async processBatch(start, end) {
      const rows = await fetchTransferLogs(INFLUENCE, start, end);
      if (rows.length > 0) await upsertInfluenceTransfers(rows);
      return rows.length;
    },
  });
}

// ── WS path ───────────────────────────────────────────────────────────────
// INFLUENCE Transfer events have no classification step — parse + upsert.
// 1.5 s flush window batches a burst from the same block before the DB hit.

let wsBuffer = [];
let wsFlushTimer = null;
const WS_FLUSH_MS = 1500;

async function flushWsBuffer() {
  const batch = wsBuffer; wsBuffer = []; wsFlushTimer = null;
  if (!batch.length) return;
  const seen = new Set();
  const unique = [];
  for (const r of batch) {
    const k = `${r.hash.toLowerCase()}:${r.logIndex}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(r);
  }
  try {
    await upsertInfluenceTransfers(unique);
    console.log(`[poller] influence (ws): ${unique.length} rows`);
  } catch (err) {
    console.error('[poller] influence (ws) flush error:', err.message);
  }
}

export function startInfluenceWs() {
  const client = getWsClient();
  client.addSubscription({
    name: 'influence-transfers',
    filter: { address: INFLUENCE.toLowerCase(), topics: [TRANSFER_TOPIC] },
    onLog: (rawLog) => {
      try { wsBuffer.push(parseTransferLog(rawLog)); } catch { return; }
      if (!wsFlushTimer) {
        wsFlushTimer = setTimeout(() => { flushWsBuffer().catch(() => {}); }, WS_FLUSH_MS);
      }
    },
  });
}
