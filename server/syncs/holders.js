import { checkIsContract } from '../etherscan.js';
import { computeHolderBalances, getKnownIsContract, upsertHolders } from '../../lib/index.js';
import { logSyncError } from './log-throttle.js';

export async function syncHolders() {
  try {
    const rows  = await computeHolderBalances(500);
    const known = await getKnownIsContract();

    const newAddrs = rows.map(r => r.addr).filter(a => !known.has(a));
    let contractMap = new Map(known);
    if (newAddrs.length > 0) {
      for (let i = 0; i < newAddrs.length; i += 50) {
        const chunk   = newAddrs.slice(i, i + 50);
        const results = await checkIsContract(chunk);
        results.forEach((v, k) => contractMap.set(k, v ? 1 : 0));
        if (i + 50 < newAddrs.length) await new Promise(r => setTimeout(r, 200));
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const holders = rows.map((r, i) => ({
      address:      r.addr,
      balance:      r.balance,
      balanceRaw:   String(Math.round(r.balance * 1e18)),
      rank:         i + 1,
      isContract:   contractMap.get(r.addr) ?? 0,
      lastSnapshot: now,
    }));

    await upsertHolders(holders);
    console.log(`[poller] holders synced: ${holders.length}`);
  } catch (err) {
    logSyncError('holders sync', err);
  }
}
