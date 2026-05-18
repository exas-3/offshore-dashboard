export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import {
  fetchTokenBalance, getUserCompaniesBatch, getTradeStates, getEntryPrices,
  getCompanyTradeWindows, fetchLatestInfCost, INFLUENCE, DIRTY,
  durationToOpType,
} from '../../../server/etherscan.js';
import { ethPriceFeed } from '../../../lib/eth-price-feed.js';
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
      Promise.resolve(ethPriceFeed.getLatest()),
      companyAddrs.length ? getEntryPrices(companyAddrs) : Promise.resolve(new Map()),
      fetchLatestInfCost().catch(() => null),
    ]);

    // Pull trade-window timestamps (startTime / endTime from storage slots 4/5)
    // for active companies so the chart can render the "trade started" marker.
    const activeAddrs = tradeStates.filter(s => s.active).map(s => s.company);
    const windowMap   = activeAddrs.length
      ? await getCompanyTradeWindows(activeAddrs).catch(() => new Map())
      : new Map();

    const companies = tradeStates.map(s => {
      const win = windowMap.get(s.company.toLowerCase());
      // Compute the op_type from the slot-derived duration here so the
      // client never has to reconcile a stale endTime (from BATCH_RESOLVER)
      // against a fresh startTime (from storage slots) — the duration is
      // computed once from a single read pair.
      const tradeType = win && win.startTime && win.endTime
        ? durationToOpType(Number(win.endTime) - Number(win.startTime))
        : null;
      return {
        ...s,
        entryPrice: entryPriceMap.get(s.company) ?? 0,
        startTime:  win?.startTime ?? null,
        tradeType,
      };
    });

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
