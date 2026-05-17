import { fetchTransferLogs, parseTransferLog, INFLUENCE } from '../etherscan.js';
import { getWsClient } from '../etherscan/ws-client.js';
import { bufferedFlush } from '../etherscan/buffered-flush.js';
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
const wsBuffer = bufferedFlush({
  label:   'poller] influence (ws)',
  flushMs: 1500,
  keyFn:   (r) => `${r.hash.toLowerCase()}:${r.logIndex}`,
  onFlush: async (rows) => {
    await upsertInfluenceTransfers(rows);
    console.log(`[poller] influence (ws): ${rows.length} rows`);
  },
});

export function startInfluenceWs() {
  const client = getWsClient();
  client.addSubscription({
    name: 'influence-transfers',
    filter: { address: INFLUENCE.toLowerCase(), topics: [TRANSFER_TOPIC] },
    onLog: (rawLog) => {
      try { wsBuffer.push(parseTransferLog(rawLog)); } catch {}
    },
  });
}
