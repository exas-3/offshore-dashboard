import { getUserCompaniesBatch, getTradeStates } from '../etherscan.js';
import { getAllPlayerAddresses, upsertCompanies } from '../../lib/index.js';

export async function syncCompanies() {
  try {
    const wallets = await getAllPlayerAddresses(10000);
    if (!wallets.length) return;

    const ownerMap = {};
    const WALLET_CHUNK = 50;
    for (let i = 0; i < wallets.length; i += WALLET_CHUNK) {
      const chunk = wallets.slice(i, i + WALLET_CHUNK);
      const result = await getUserCompaniesBatch(chunk);
      for (const [wallet, companies] of Object.entries(result)) {
        for (const addr of companies) ownerMap[addr] = wallet;
      }
      if (i + WALLET_CHUNK < wallets.length) await new Promise(r => setTimeout(r, 300));
    }

    const allCompanies = Object.keys(ownerMap);
    if (!allCompanies.length) return;

    const allStates = [];
    const STATE_CHUNK = 100;
    for (let i = 0; i < allCompanies.length; i += STATE_CHUNK) {
      const chunk = allCompanies.slice(i, i + STATE_CHUNK);
      const states = await getTradeStates(chunk);
      allStates.push(...states.map(s => ({ ...s, owner: ownerMap[s.company] ?? '' })));
      if (i + STATE_CHUNK < allCompanies.length) await new Promise(r => setTimeout(r, 500));
    }

    await upsertCompanies(allStates);
    const autoOn = allStates.filter(s => s.autoTradeEnabled).length;
    const active  = allStates.filter(s => s.active).length;
    console.log(`[poller] companies synced: ${allStates.length} total, ${active} active, ${autoOn} auto-trade on`);
  } catch (err) {
    console.error('[poller] companies sync error:', err.message);
  }
}
