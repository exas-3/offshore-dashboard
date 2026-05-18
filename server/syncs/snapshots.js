import { fetchSupply, fetchEthPrice, fetchDirtyPrice, fetchLatestInfCost, DIRTY, INFLUENCE } from '../etherscan.js';
import {
  saveTokenInfoSnapshot, saveEthPriceSnapshot, saveInfluenceSupply,
  savePriceSnapshot, cleanupOldEthPrices, computeTrueHolderCount,
} from '../../lib/index.js';
import { logSyncError } from './log-throttle.js';

export async function syncSnapshots() {
  try {
    const [dirtySupply, infSupply, ethPrice, dirtyPrice, infCost] = await Promise.allSettled([
      fetchSupply(DIRTY),
      fetchSupply(INFLUENCE),
      fetchEthPrice(),
      fetchDirtyPrice(),
      fetchLatestInfCost(),
    ]);

    if (dirtySupply.status === 'fulfilled') {
      const holders = await computeTrueHolderCount();
      await saveTokenInfoSnapshot(dirtySupply.value, holders || null);
      console.log(`[poller] supply=${dirtySupply.value.toFixed(0)} holders=${holders}`);
    } else {
      logSyncError('supply', dirtySupply.reason);
    }

    if (infSupply.status === 'fulfilled') {
      await saveInfluenceSupply(infSupply.value);
    } else {
      logSyncError('influence supply', infSupply.reason);
    }

    if (ethPrice.status === 'fulfilled') {
      await saveEthPriceSnapshot(ethPrice.value);
    } else {
      logSyncError('eth price', ethPrice.reason);
    }

    const d = dirtyPrice.status === 'fulfilled' ? dirtyPrice.value : null;
    const i = infCost.status   === 'fulfilled' ? infCost.value   : null;
    if (d != null || i != null) {
      await savePriceSnapshot(d, i);
      console.log(`[poller] prices dirty=${d?.toFixed(4)} inf=${i?.toFixed(2)}`);
    }

    await cleanupOldEthPrices();
  } catch (err) {
    logSyncError('snapshot', err);
  }
}
