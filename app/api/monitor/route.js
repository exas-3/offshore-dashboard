export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import {
  fetchTokenBalance, getUserCompaniesBatch, getTradeStates, getEntryPrices,
  getCompanyTradeWindows, fetchLatestInfCost, INFLUENCE, DIRTY,
  durationToOpType,
} from '../../../server/etherscan.js';
import { ethPriceFeed } from '../../../lib/eth-price-feed.js';
import { getPlayerStats, getWalletLabel, getDb, getActiveTradesAt, getPricesAt } from '../../../lib/index.js';
import { resolveAsOf, nowCap } from '../../../lib/demo-clock.js';
import { getCycleStart } from '../offshore-data/helpers.js';

export async function GET(req) {
  const wallet = new URL(req.url).searchParams.get('wallet')?.toLowerCase().trim();
  if (!wallet || !/^0x[0-9a-f]{40}$/i.test(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  const asOf = resolveAsOf(req);
  if (asOf != null) {
    // Demo branch: zero RPC. Active trades reconstructed from settled ops;
    // balances from transfer deltas as of the virtual moment.
    try {
      const { now, cap } = nowCap(asOf);
      const db = getDb();
      const [trades, balRow, infRow, prices, playerStats, labelRow] = await Promise.all([
        getActiveTradesAt(asOf, { owner: wallet }).catch(() => []),
        db`
          SELECT COALESCE(SUM(CASE WHEN to_addr=${wallet} THEN amount ELSE -amount END), 0)::float AS bal
          FROM transfers WHERE (to_addr=${wallet} OR from_addr=${wallet}) AND timestamp <= ${cap}
        `.catch(() => [{ bal: 0 }]),
        db`
          SELECT COALESCE(SUM(CASE WHEN to_addr=${wallet} THEN amount ELSE -amount END), 0)::float AS bal
          FROM influence_transfers WHERE (to_addr=${wallet} OR from_addr=${wallet}) AND timestamp <= ${cap}
        `.catch(() => [{ bal: 0 }]),
        getPricesAt(asOf).catch(() => ({ dirty: null, infCost: null })),
        getPlayerStats(wallet, getCycleStart(now), asOf).catch(() => null),
        getWalletLabel(wallet).catch(() => null),
      ]);

      const companies = trades.map(t => ({
        company:          t.hash,
        active:           true,
        completable:      false,
        liquidatable:     false,
        endTime:          t.endTime,
        liqPrice:         '0',
        autoTradeEnabled: false,
        cooldownEnd:      0,
        entryPrice:       0,
        startTime:        t.startTime,
        tradeType:        t.opType,
        locationId:       null,
      }));

      return NextResponse.json({
        demo: true,
        wallet,
        influenceBalance: Math.max(0, Number(infRow[0]?.bal ?? 0)),
        dirtyBalance:     Math.max(0, Number(balRow[0]?.bal ?? 0)),
        currentEthPrice:  null,
        infCost:          prices.infCost,
        companies,
        summary: {
          total: companies.length,
          autoTradeOn: 0,
          autoTradeOff: companies.length,
          activeCount: companies.length,
          liquidatable: 0,
          completable: 0,
        },
        playerStats,
        label: labelRow ? {
          label:             labelRow.label || null,
          label_score:       labelRow.label_score != null ? Number(labelRow.label_score) : null,
          label_computed_at: labelRow.label_computed_at != null ? Number(labelRow.label_computed_at) : null,
        } : null,
      });
    } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  try {
    const [influenceBalance, dirtyBalance, companiesMap] = await Promise.all([
      fetchTokenBalance(INFLUENCE, wallet),
      fetchTokenBalance(DIRTY, wallet),
      getUserCompaniesBatch([wallet]),
    ]);

    const companyAddrs = companiesMap[wallet] ?? [];

    const [tradeStates, playerStats, currentEthPrice, entryPriceMap, infCost, labelRow] = await Promise.all([
      companyAddrs.length ? getTradeStates(companyAddrs) : Promise.resolve([]),
      getPlayerStats(wallet).catch(() => null),
      Promise.resolve(ethPriceFeed.getLatest()),
      companyAddrs.length ? getEntryPrices(companyAddrs) : Promise.resolve(new Map()),
      fetchLatestInfCost().catch(() => null),
      getWalletLabel(wallet).catch(() => null),
    ]);

    // Pull trade-window timestamps (startTime / endTime from storage slots 4/5)
    // for active companies so the chart can render the "trade started" marker.
    const activeAddrs = tradeStates.filter(s => s.active).map(s => s.company);
    const windowMap   = activeAddrs.length
      ? await getCompanyTradeWindows(activeAddrs).catch(() => new Map())
      : new Map();

    // Look up location_id from the DB for every company we know about — set
    // once at deployment so a single query is enough; no RPC per request.
    const lcAddrs = tradeStates.map(s => s.company.toLowerCase());
    const locRows = lcAddrs.length
      ? await getDb()`SELECT address, location_id FROM companies WHERE address = ANY(${lcAddrs})`.catch(() => [])
      : [];
    const locMap = new Map(locRows.map(r => [r.address, r.location_id]));

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
        locationId: locMap.get(s.company.toLowerCase()) ?? null,
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
      label: labelRow ? {
        label:             labelRow.label || null,
        label_score:       labelRow.label_score != null ? Number(labelRow.label_score) : null,
        label_computed_at: labelRow.label_computed_at != null ? Number(labelRow.label_computed_at) : null,
      } : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
