export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import {
  fetchTokenBalance, getUserCompaniesBatch, getTradeStates, getEntryPrices,
  fetchEthPrice, fetchLatestInfCost, INFLUENCE, DIRTY,
} from '../../../server/etherscan.js';
import { getPlayerStats } from '../../../lib/index.js';

export async function GET(req) {
  const wallet = new URL(req.url).searchParams.get('wallet')?.toLowerCase().trim();
  if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  try {
    const [influenceBalance, dirtyBalance, companiesMap] = await Promise.all([
      fetchTokenBalance(INFLUENCE, wallet),
      fetchTokenBalance(DIRTY, wallet),
      getUserCompaniesBatch([wallet]),
    ]);

    const companyAddrs = companiesMap[wallet] ?? [];

    const [tradeStates, playerStats, currentEthPrice, entryPriceMap, infCost] = await Promise.all([
      companyAddrs.length ? getTradeStates(companyAddrs) : Promise.resolve([]),
      getPlayerStats(wallet).catch(() => null),
      fetchEthPrice().catch(() => null),
      companyAddrs.length ? getEntryPrices(companyAddrs) : Promise.resolve(new Map()),
      fetchLatestInfCost().catch(() => null),
    ]);

    const companies = tradeStates.map(s => ({
      ...s,
      entryPrice: entryPriceMap.get(s.company) ?? 0,
    }));

    const autoTradeOn  = companies.filter(s => s.autoTradeEnabled).length;
    const autoTradeOff = companies.filter(s => !s.autoTradeEnabled).length;
    const activeCount  = companies.filter(s => s.active).length;
    const liquidatable = companies.filter(s => s.liquidatable).length;
    const completable  = companies.filter(s => s.completable).length;

    return NextResponse.json({
      wallet,
      influenceBalance,
      dirtyBalance,
      currentEthPrice,
      infCost,
      companies,
      summary: {
        total: tradeStates.length,
        autoTradeOn,
        autoTradeOff,
        activeCount,
        liquidatable,
        completable,
      },
      playerStats,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
