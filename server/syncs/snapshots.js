import { fetchSupply, fetchEthPrice, fetchDirtyPrice, fetchLatestInfCost, DIRTY, INFLUENCE } from '../etherscan.js';
import {
  saveTokenInfoSnapshot, saveEthPriceSnapshot, saveInfluenceSupply,
  savePriceSnapshot, cleanupOldEthPrices, computeTrueHolderCount,
} from '../../lib/index.js';

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
      console.error('[poller] supply error:', dirtySupply.reason.message);
    }

    if (infSupply.status === 'fulfilled') {
      await saveInfluenceSupply(infSupply.value);
    } else {
      console.error('[poller] influence supply error:', infSupply.reason.message);
    }

    if (ethPrice.status === 'fulfilled') {
      await saveEthPriceSnapshot(ethPrice.value);
    } else {
      console.error('[poller] eth price error:', ethPrice.reason.message);
    }

    const d = dirtyPrice.status === 'fulfilled' ? dirtyPrice.value : null;
    const i = infCost.status   === 'fulfilled' ? infCost.value   : null;
    if (d != null || i != null) {
      await savePriceSnapshot(d, i);
      console.log(`[poller] prices dirty=${d?.toFixed(4)} inf=${i?.toFixed(2)}`);
    }

    await cleanupOldEthPrices();
  } catch (err) {
    console.error('[poller] snapshot error:', err.message);
  }
}
