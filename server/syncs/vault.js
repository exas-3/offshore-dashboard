import { fetchTransferLogs, parseTransferLog, USDM, VAULT } from '../etherscan.js';
import { getWsClient } from '../etherscan/ws-client.js';
import { bufferedFlush } from '../etherscan/buffered-flush.js';
import { getLastVaultBlock, setLastVaultBlock, upsertVaultPayouts } from '../../lib/index.js';
import { runBlockSync } from './_run.js';

const VAULT_START      = 15_194_000;
const VAULT_ADDR       = VAULT.toLowerCase();
const TRANSFER_TOPIC   = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// topic[1] of a Transfer event = zero-padded `from` address. Filtering on
// this means the WS stream only delivers vault → recipient transfers.
const VAULT_FROM_TOPIC = '0x' + '0'.repeat(24) + VAULT_ADDR.slice(2);

function toPayout(log) {
  return {
    hash:      log.hash,
    logIndex:  log.logIndex,
    blockNum:  log.blockNum,
    timestamp: log.timestamp,
    recipient: log.toAddr,
    amount:    log.amount,
  };
}

// ── Polling path (safety net) ─────────────────────────────────────────────
export function syncVault(latestBlock) {
  return runBlockSync({
    name: 'vault',
    getLast: getLastVaultBlock,
    setLast: setLastVaultBlock,
    fromStart: VAULT_START,
    batch: 2_000,
    latestBlock,
    async processBatch(start, end) {
      const logs    = await fetchTransferLogs(USDM, start, end);
      const payouts = logs.filter(l => l.fromAddr === VAULT_ADDR);
      if (payouts.length === 0) return 0;
      await upsertVaultPayouts(payouts.map(toPayout));
      return payouts.length;
    },
  });
}

// ── WS path ───────────────────────────────────────────────────────────────
// USDM Transfer events where `from = VAULT` are exactly the payout set —
// no extra filter needed on our side because the WS topic filter does it.
const wsBuffer = bufferedFlush({
  label:   'poller] vault (ws)',
  flushMs: 1500,
  keyFn:   (p) => `${p.hash.toLowerCase()}:${p.logIndex}`,
  onFlush: async (payouts) => {
    await upsertVaultPayouts(payouts);
    console.log(`[poller] vault (ws): ${payouts.length} payouts`);
  },
});

export function startVaultWs() {
  const client = getWsClient();
  client.addSubscription({
    name:   'vault-payouts',
    filter: {
      address: USDM.toLowerCase(),
      topics:  [TRANSFER_TOPIC, VAULT_FROM_TOPIC],
    },
    onLog: (raw) => {
      try { wsBuffer.push(toPayout(parseTransferLog(raw))); } catch (err) {
        console.warn('[poller] vault (ws) parse failed:', err.message);
      }
    },
  });
}
