import { fetchTransferLogs, USDM, VAULT } from '../etherscan.js';
import { getLastVaultBlock, setLastVaultBlock, upsertVaultPayouts } from '../../lib/index.js';
import { runBlockSync } from './_run.js';

const VAULT_START = 15_194_000;
const VAULT_ADDR  = VAULT.toLowerCase();

export function syncVault() {
  return runBlockSync({
    name: 'vault',
    getLast: getLastVaultBlock,
    setLast: setLastVaultBlock,
    fromStart: VAULT_START,
    batch: 2_000,
    async processBatch(start, end) {
      const logs    = await fetchTransferLogs(USDM, start, end);
      const payouts = logs.filter(l => l.fromAddr === VAULT_ADDR);
      if (payouts.length === 0) return 0;
      await upsertVaultPayouts(payouts.map(l => ({
        hash: l.hash, logIndex: l.logIndex, blockNum: l.blockNum,
        timestamp: l.timestamp, recipient: l.toAddr, amount: l.amount,
      })));
      return payouts.length;
    },
  });
}
