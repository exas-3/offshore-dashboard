import { fetchTransferLogs, INFLUENCE } from '../etherscan.js';
import { getLastInfluenceBlock, setLastInfluenceBlock, upsertInfluenceTransfers } from '../../lib/index.js';
import { runBlockSync } from './_run.js';

const INFLUENCE_START = 15_194_000;

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
