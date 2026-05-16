export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import {
  getStats, getLatestTokenInfo, getHolderCount, getPlayerCount,
  getInfluenceStats, getVaultStats,
  getCompanyStats, getCompanies, getDb,
  getDexRecentSwaps,
  getRecentTransfers, getLatestEthPrice,
  getEnhancedLeaderboard,
  getDirtyMarketCapHistory,
} from '../../../lib/index.js';
import {
  getFlowBuckets, getBurnBuckets, getInfluenceBuckets,
  getParticipantBuckets, getActiveWalletBuckets,
  getSupplyHistoryForChart, getPriceBaseline25h,
} from '../../../lib/db.js';
import {
  fetchDirtyPrice, fetchLatestInfCost, getLatestBlock,
  getCompanyTradeTypes, _companyTypeCache,
} from '../../../server/etherscan.js';
import { ethPriceFeed } from '../../../lib/eth-price-feed.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// ── Cycle boundary helpers (mirrors vault/route.js) ───────────────────────────
const WEEKDAY_ANCHOR = 5400;
const WEEKDAY_DUR    = 8 * 3600;
const WEEKEND_ANCHOR = 9 * 3600 + 30 * 60;

function isWeekendTs(ts) {
  const d = new Date(ts * 1000);
  const dow = d.getUTCDay();
  const s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  if (dow === 6 && s >= WEEKEND_ANCHOR) return true;
  if (dow === 0) return true;
  if (dow === 1 && s < WEEKEND_ANCHOR) return true;
  return false;
}

function getCycleStart(ts) {
  if (!isWeekendTs(ts)) {
    return Math.floor((ts - WEEKDAY_ANCHOR) / WEEKDAY_DUR) * WEEKDAY_DUR + WEEKDAY_ANCHOR;
  }
  const d = new Date(ts * 1000);
  const s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  const dayStart = ts - s;
  return s >= WEEKEND_ANCHOR ? dayStart + WEEKEND_ANCHOR : dayStart - 86400 + WEEKEND_ANCHOR;
}

// ── Game quarter mapping ───────────────────────────────────────────────────────
// Anchor: cycle #20 (absolute sequence) = Q3 2013.
// Weekdays: 3 cycles/day. Weekends: 1 cycle/day.
// Each vault cycle = 1 in-game quarter.
const ANCHOR_CYCLE = 20;
const ANCHOR_Q_IDX = 2013 * 4 + 2; // Q3 2013, 0-indexed (Q1=0, Q2=1, Q3=2, Q4=3)

function cycleQuarter(cycleNum) {
  const qIdx = ANCHOR_Q_IDX + (cycleNum - ANCHOR_CYCLE);
  const year = Math.floor(qIdx / 4);
  const q    = ((qIdx % 4) + 4) % 4;
  return `Q${q + 1} ${year}`;
}

// ── Format helpers ─────────────────────────────────────────────────────────────

function fmtDate(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function fmtDateHour(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}h`;
}

function fmtCycleTime(ts) {
  const d = new Date(Number(ts) * 1000);
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${M[d.getUTCMonth()]} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2,'0')}:${d.getUTCMinutes() < 30 ? '00' : '30'}`;
}

function fmtM(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr ?? '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function liqPriceUsd(raw) {
  if (!raw || raw === '0') return 0;
  try { return Number(BigInt(raw) / 10n ** 12n) / 1e6; }
  catch { return 0; }
}

function fmtCountdown(endTime) {
  if (!endTime) return '—';
  const diff = endTime - Math.floor(Date.now() / 1000);
  if (diff <= 0) return '—';
  if (diff < 60) return `${diff}s`;
  const m = Math.floor(diff / 60), s = diff % 60;
  if (diff < 3600) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${Math.floor(diff / 3600)}h ${String(m % 60).padStart(2,'0')}m`;
}

function mapOpType(opType) {
  const m = {
    DRUG_DEAL: 'drugs', ARMS_DEAL: 'arms', EXTORTION: 'extortion',
    PARTIAL: 'op', FAIL: 'op', SCRAP: 'scrap', BUY_ASSET: 'buy-asset',
    LEVEL_UP: 'level-up', THIRD_ENTERPRISE: 'buy-asset',
  };
  return m[opType] ?? opType.toLowerCase().replace(/_/g, '-');
}

// ── Cache ──────────────────────────────────────────────────────────────────────
let _cache = null, _cacheTs = 0;
const TTL = 30_000;

const DEMO_WALLET = '0x75d6cec583ca2ec96850659b6b4a55dae071d40b';

export async function GET() {
  try {
    if (_cache && Date.now() - _cacheTs < TTL) {
      return new NextResponse(JSON.stringify(_cache), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const heatmapStart = Math.floor((now - 7 * 86400) / 86400) * 86400;
    const db = getDb();

    // ── All queries in parallel ──────────────────────────────────────────────
    const [
      stats, tokenInfo, holderCount, playerCount,
      flowBuckets, flowBucketsDaily, burnBuckets, influenceBuckets, influenceBucketsHourly, participantBuckets, activeWalletBuckets,
      influenceStats, vaultStats,
      companyStats, companies,
      supplyHistory, dexSwaps,
      recentTransfers, ethPriceDb,
      dirtyPriceResult, infCostResult, latestBlock, ethPriceLive,
      rawLeaderboard, marketCapHistory, priceBase25h,
    ] = await Promise.all([
      getStats(), getLatestTokenInfo(), getHolderCount(), getPlayerCount(),
      getFlowBuckets(3600).catch(() => []),
      getFlowBuckets(86400).catch(() => []),
      getBurnBuckets(86400).catch(() => []),
      getInfluenceBuckets(86400).catch(() => []),
      getInfluenceBuckets(3600).catch(() => []),
      getParticipantBuckets(86400).catch(() => []),
      getActiveWalletBuckets(86400).catch(() => []),
      getInfluenceStats(), getVaultStats(),
      getCompanyStats(), getCompanies('active', 200),
      getSupplyHistoryForChart(86400).catch(() => []),
      getDexRecentSwaps(20).catch(() => []),
      getRecentTransfers(250).catch(() => []),
      getLatestEthPrice().catch(() => null),
      fetchDirtyPrice().catch(() => null),
      fetchLatestInfCost().catch(() => null),
      getLatestBlock().catch(() => null),
      Promise.resolve(ethPriceFeed.getLatest()),
      getEnhancedLeaderboard(15).catch(() => []),
      getDirtyMarketCapHistory().catch(() => []),
      getPriceBaseline25h().catch(() => ({ dirty: null, infCost: null, eth: null })),
    ]);

    // Raw DB queries that need the connection directly
    const [heatmapRows, cycleRows, todayActiveRow, recentOpsRow,
           walletStats, walletEarnedByOp, walletSpentByOp,
           walletFarmedEarned, walletFarmedSpent, infHistRows, opsMatrixRows] = db ? await Promise.all([
      db`
        SELECT
          FLOOR((timestamp - ${heatmapStart}) / 86400)::int AS day_idx,
          FLOOR((timestamp::bigint % 86400) / 3600)::int    AS hour_idx,
          COUNT(*)::int AS cnt
        FROM transfers
        WHERE kind = 'MINT' AND timestamp >= ${heatmapStart}
        GROUP BY 1, 2
      `.catch(() => []),
      db`
        SELECT timestamp::float AS ts, amount::float AS amount, recipient
        FROM vault_payouts
        ORDER BY timestamp ASC
      `.catch(() => []),
      db`
        SELECT COUNT(DISTINCT to_addr)::int AS cnt
        FROM transfers WHERE kind = 'MINT' AND timestamp >= ${now - 86400}
      `.catch(() => [{ cnt: 0 }]),
      db`
        SELECT COUNT(*)::int AS cnt
        FROM transfers WHERE kind = 'MINT' AND timestamp >= ${now - 60}
      `.catch(() => [{ cnt: 0 }]),
      // Demo wallet aggregate stats
      db`
        SELECT
          (SELECT COUNT(*)::int FROM transfers WHERE kind='MINT' AND to_addr=${DEMO_WALLET}) AS total_ops,
          (SELECT COALESCE(SUM(amount),0)::float FROM transfers WHERE kind='MINT' AND to_addr=${DEMO_WALLET}) AS dirty_earned,
          (SELECT COALESCE(SUM(amount),0)::float FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr=${DEMO_WALLET}) AS dirty_spent,
          (SELECT COALESCE(SUM(amount),0)::float FROM influence_transfers WHERE to_addr=${DEMO_WALLET} AND kind='MINT') AS inf_bought_total,
          (SELECT COUNT(*)::int FROM influence_transfers WHERE to_addr=${DEMO_WALLET} AND kind='MINT') AS inf_bought_purchases,
          (SELECT COALESCE(SUM(amount),0)::float FROM influence_transfers WHERE from_addr=${DEMO_WALLET} AND kind='BURN') AS inf_refunded,
          (SELECT COALESCE(SUM(amount),0)::float FROM transfers WHERE kind='TRANSFER' AND op_type='DEX_SELL' AND from_addr=${DEMO_WALLET}) AS dex_sold,
          (SELECT COUNT(*)::int FROM transfers WHERE kind='TRANSFER' AND op_type='DEX_SELL' AND from_addr=${DEMO_WALLET}) AS dex_sold_txs,
          (SELECT COALESCE(SUM(amount),0)::float FROM transfers WHERE kind='TRANSFER' AND op_type='DEX_BUY' AND to_addr=${DEMO_WALLET}) AS dex_bought,
          (SELECT COUNT(*)::int FROM transfers WHERE kind='TRANSFER' AND op_type='DEX_BUY' AND to_addr=${DEMO_WALLET}) AS dex_bought_txs,
          (SELECT COALESCE(SUM(amount),0)::float FROM vault_payouts WHERE recipient=${DEMO_WALLET}) AS vault_claimed,
          (SELECT COUNT(*)::int FROM vault_payouts WHERE recipient=${DEMO_WALLET}) AS vault_payouts,
          (SELECT COALESCE(balance,0)::float FROM token_holders WHERE address=${DEMO_WALLET}) AS balance
      `.catch(() => [{}]),
      // Demo wallet earned breakdown by op type
      db`
        SELECT op_type, COUNT(*)::int as ops, SUM(amount)::float as dirty
        FROM transfers WHERE kind='MINT' AND to_addr=${DEMO_WALLET}
        GROUP BY op_type ORDER BY dirty DESC
      `.catch(() => []),
      // Demo wallet spent breakdown by op type
      db`
        SELECT op_type, COUNT(*)::int as ops, SUM(amount)::float as dirty
        FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr=${DEMO_WALLET}
        GROUP BY op_type ORDER BY dirty DESC
      `.catch(() => []),
      // Demo wallet daily earned
      db`
        SELECT FLOOR(timestamp / 86400)::int * 86400 AS day_ts, SUM(amount)::float AS earned
        FROM transfers WHERE kind='MINT' AND to_addr=${DEMO_WALLET}
        GROUP BY 1 ORDER BY 1 ASC
      `.catch(() => []),
      // Demo wallet daily spent
      db`
        SELECT FLOOR(timestamp / 86400)::int * 86400 AS day_ts, SUM(amount)::float AS spent
        FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr=${DEMO_WALLET}
        GROUP BY 1 ORDER BY 1 ASC
      `.catch(() => []),
      // INF cost history for ticker tooltip (all time, hourly)
      db`
        SELECT inf_cost::float AS v, timestamp AS t
        FROM price_snapshots
        WHERE inf_cost IS NOT NULL
        ORDER BY timestamp ASC
      `.catch(() => []),
      // ops matrix seed
      db`
        SELECT op_type,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 60})   AS m1,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 300})  AS m5,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 900})  AS m15,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 1800}) AS m30,
          COUNT(*) FILTER (WHERE timestamp::bigint >= ${now - 3600}) AS m60
        FROM transfers
        WHERE kind = 'MINT' AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION')
          AND timestamp::bigint >= ${now - 3600}
        GROUP BY op_type
      `.catch(() => []),
    ]) : [[], [], [{ cnt: 0 }], [{ cnt: 0 }], [{}], [], [], [], [], [], []];

    // ── Resolve prices ───────────────────────────────────────────────────────
    const dirtyPrice = dirtyPriceResult ?? 0;
    const infCost    = typeof infCostResult === 'number' ? infCostResult : 12.41;
    const ethPrice   = ethPriceLive ?? ethPriceDb ?? 2300;

    // ── hero ─────────────────────────────────────────────────────────────────
    const supply = Number(tokenInfo.supply ?? 0);
    const burned = stats.dirtySpentTotal;
    const hero = {
      dirtyPrice,
      opCost: infCost,
      supply,
      supplyTotalCirculating: Math.round(supply).toLocaleString(),
      burnedRatio: supply > 0 ? Math.round((burned / supply) * 100) / 100 : 0,
      burnedAllTime: fmtM(burned),
      totalOps: stats.opsTotal,
      totalOpsLabel: stats.opsTotal.toLocaleString(),
      dirtyEmitted: fmtM(stats.dirtyMintedTotal),
      tokenHolders: holderCount,
      uniqueWallets: playerCount,
    };

    // ── supplyOverTime ────────────────────────────────────────────────────────
    const supplyOverTime = supplyHistory.slice(-30).map(r => ({
      ts: Number(r.ts), x: fmtDate(r.ts),
      v: Number(r.supply),
    }));

    // ── marketCapChart ────────────────────────────────────────────────────────
    const marketCapChart = marketCapHistory.map(r => ({
      ts: Number(r.ts), x: fmtDateHour(r.ts),
      v: r.marketCap,
      price: r.price,
      supply: r.supply,
    }));

    // ── emissionsVsBurn (hourly last 24h + daily all-time) ────────────────────
    const emissionsVsBurn = flowBuckets.slice(-24).map(r => ({
      ts: Number(r.ts), label: fmtDateHour(r.ts),
      minted: r.minted,
      spent: r.spent,
      protocolMint: r.protocolMint,
      net: r.net,
    }));
    const emissionsVsBurnDaily = flowBucketsDaily.map(r => ({
      ts: Number(r.ts), label: fmtDate(r.ts),
      minted: r.minted,
      spent: r.spent,
      protocolMint: r.protocolMint,
      net: r.net,
    }));

    // ── influenceFlow ─────────────────────────────────────────────────────────
    const influenceFlow = {
      totals: {
        purchased:   influenceStats.totalPurchased,
        consumed:    influenceStats.totalBurned,
        refunded:    influenceStats.totalRefunded,
        circulating: Number(influenceStats.circulating ?? 0),
      },
      days: influenceBuckets.slice(-9).map(r => ({
        ts: Number(r.ts), x: fmtDate(r.ts),
        purchased: r.purchased,
        consumed:  r.burned,
        refunded:  Math.max(0, r.minted - r.purchased),
      })),
      hours: influenceBucketsHourly.slice(-24).map(r => ({
        ts: Number(r.ts), x: fmtDateHour(r.ts),
        purchased: r.purchased,
        consumed:  r.burned,
        refunded:  Math.max(0, r.minted - r.purchased),
      })),
    };

    // ── burnedDaily ───────────────────────────────────────────────────────────
    const burnedDaily = burnBuckets.slice(-9).map(r => ({
      ts: Number(r.ts), x: fmtDate(r.ts),
      protocolBurn: r.burned,
      asset:        r.assets,
      levelUp:      r.levels,
      thirdEnt:     r.enterprise,
    }));

    // ── participants & active wallets ─────────────────────────────────────────
    const newParticipants = participantBuckets.slice(-9).map(r => ({
      ts: Number(r.ts), x: fmtDate(r.ts),
      v: r.newWallets,
    }));
    const newParticipantsTotal = playerCount;

    let _cum = 0;
    const totalPlayersChart = participantBuckets.map(r => {
      _cum += r.newWallets;
      return { ts: Number(r.ts), x: fmtDate(r.ts), v: _cum };
    });

    const dailyActiveWallets = activeWalletBuckets.map(r => ({
      ts: Number(r.ts), x: fmtDate(r.ts),
      v: r.activeWallets,
    }));
    const dailyActiveWalletsPeak = activeWalletBuckets.length
      ? Math.max(...activeWalletBuckets.map(r => r.activeWallets))
      : 0;

    // ── vault cycles — group raw payouts by actual cycle boundary ─────────────
    // Weekdays: 3 cycles/day at 01:30, 09:30, 17:30 UTC (8h each)
    // Weekends: 1 cycle/day at 09:30 UTC (24h)
    const cycleMap = new Map();
    for (const row of cycleRows) {
      const start = getCycleStart(Number(row.ts));
      if (!cycleMap.has(start)) cycleMap.set(start, { distributed: 0, recipients: new Set() });
      const e = cycleMap.get(start);
      e.distributed += Number(row.amount);
      e.recipients.add(row.recipient);
    }
    const sortedStarts = [...cycleMap.keys()].sort((a, b) => a - b);
    const cycleHistory = sortedStarts.map((start, idx) => {
      const cycleNum = idx + 1;
      const e = cycleMap.get(start);
      return { t: cycleQuarter(cycleNum), cycleNum, distributed: e.distributed, recipients: e.recipients.size };
    });

    const usdmPerCycle = cycleHistory.slice(-20).map(r => ({ t: r.t, v: r.distributed }));
    const recipientsPerCycle = cycleHistory.map(r => ({ t: r.t, v: r.recipients }));
    const newRecipientsPerCycle = [];
    const distributionTotals = {
      total:            vaultStats.totalPaid,
      totalLabel:       fmtM(vaultStats.totalPaid),
      cyclesPaid:       cycleMap.size,
      uniqueRecipients: vaultStats.uniqueRecipients,
    };

    // ── companies ─────────────────────────────────────────────────────────────
    const companiesData = {
      totalCompanies:     companyStats.total,
      uniqueOwners:       companyStats.uniqueOwners,
      activeTrades:       companyStats.activeCount,
      autoTradeOn:        companyStats.autoTradeCount,
      autoTradeShareLabel: companyStats.total > 0
        ? `${Math.round(companyStats.autoTradeCount / companyStats.total * 100)}% of all`
        : '0% of all',
    };

    // ── liveTrades ────────────────────────────────────────────────────────────
    const liveTrades = companies.map(c => {
      const liq = liqPriceUsd(c.liq_price);
      return {
        id:       shortAddr(c.address),
        owner:    c.owner,
        auto:     c.auto_trade,
        active:   c.active,
        endTime:  c.active ? Number(c.end_time) : null,
        endsIn:   c.active ? fmtCountdown(c.end_time) : '—',
        liqPrice: liq,
        ethPrice,
        buffer:   Math.round((ethPrice - liq) * 100) / 100,
        opType:   '—',
      };
    });

    // ── heatmap ───────────────────────────────────────────────────────────────
    const heatmapGrid = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of heatmapRows) {
      const di = Number(r.day_idx), hi = Number(r.hour_idx);
      if (di >= 0 && di < 7 && hi >= 0 && hi < 24) heatmapGrid[di][hi] = Number(r.cnt);
    }
    const heatmapDayTs = Array.from({ length: 7 }, (_, i) => heatmapStart + i * 86400);
    const heatmapDays = heatmapDayTs.map(fmtDate);

    // ── liveTradeTicker — real mixed event feed ───────────────────────────────
    const rawTicker = db ? await db`
      (SELECT 'DEX_SELL' AS etype, from_addr AS addr, amount, timestamp
        FROM transfers WHERE kind='TRANSFER' AND op_type='DEX_SELL' AND amount >= 1000
        ORDER BY timestamp DESC LIMIT 15)
      UNION ALL
      (SELECT 'DEX_BUY' AS etype, to_addr, amount, timestamp
        FROM transfers WHERE kind='TRANSFER' AND op_type='DEX_BUY' AND amount >= 1000
        ORDER BY timestamp DESC LIMIT 10)
      UNION ALL
      (SELECT op_type AS etype, to_addr, amount, timestamp
        FROM transfers WHERE kind='MINT'
          AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL','SCRAP')
        ORDER BY timestamp DESC LIMIT 20)
      UNION ALL
      (SELECT op_type AS etype, from_addr, amount, timestamp
        FROM transfers WHERE kind='SPEND'
          AND op_type IN ('BUY_ASSET','LEVEL_UP','THIRD_ENTERPRISE')
        ORDER BY timestamp DESC LIMIT 10)
      UNION ALL
      (SELECT 'STAKE' AS etype, user_addr AS addr, amount::numeric, timestamp
        FROM staking_deposits
        ORDER BY timestamp DESC LIMIT 10)
      ORDER BY timestamp DESC LIMIT 60
    `.catch(() => []) : [];

    const tickerKind  = { DEX_SELL:'sell', DEX_BUY:'buy', DRUG_DEAL:'op', ARMS_DEAL:'op', EXTORTION:'op', PARTIAL:'op', FAIL:'op', SCRAP:'op', BUY_ASSET:'op', LEVEL_UP:'op', THIRD_ENTERPRISE:'op', STAKE:'stake' };
    const tickerLabel = { DEX_SELL:'DEX SELL', DEX_BUY:'DEX BUY', DRUG_DEAL:'DRUG DEAL', ARMS_DEAL:'ARMS DEAL', EXTORTION:'EXTORTION', PARTIAL:'OP', FAIL:'OP', SCRAP:'SCRAP', BUY_ASSET:'BUY ASSET', LEVEL_UP:'LEVEL UP', THIRD_ENTERPRISE:'3RD ENTERPRISE', STAKE:'STAKE' };

    const liveTradeTicker = rawTicker.map(e => ({
      kind:     tickerKind[e.etype]  || 'op',
      label:    tickerLabel[e.etype] || e.etype,
      amount:   fmtM(Number(e.amount)),
      _amount:  Number(e.amount),
      token:    '$DIRTY',
      addr:     shortAddr(e.addr),
      addrFull: e.addr,
      _ts:      Number(e.timestamp),
    }));

    // ── ops seed for the animated feed ────────────────────────────────────────
    const EARN_OPS = new Set(['DRUG_DEAL', 'ARMS_DEAL', 'EXTORTION', 'PARTIAL', 'FAIL']);
    const COMPLETE_AMOUNTS = new Set([100, 115, 130]);

    // Deduplicate: same wallet + same tx → collapse into one entry (sum amounts)
    const opDedupMap = new Map();
    for (const t of recentTransfers) {
      if (!((t.kind === 'MINT' && t.op_type && t.op_type !== '') ||
            (t.kind === 'SPEND' && ['BUY_ASSET','LEVEL_UP','THIRD_ENTERPRISE'].includes(t.op_type)))) continue;
      const wallet = t.kind === 'MINT' ? t.to_addr : t.from_addr;
      const key = `${t.hash}:${wallet}:${t.op_type}`;
      if (opDedupMap.has(key)) {
        opDedupMap.get(key)._rawAmount += Number(t.amount);
        opDedupMap.get(key)._count += 1;
      } else {
        opDedupMap.set(key, { ...t, _rawAmount: Number(t.amount), _count: 1 });
      }
    }
    const recentOps = [...opDedupMap.values()]
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp) || Number(b.log_index) - Number(a.log_index))
      .slice(0, 250)
      .map(t => ({
        wallet: shortAddr(t.kind === 'MINT' ? t.to_addr : t.from_addr),
        walletFull: (t.kind === 'MINT' ? t.to_addr : t.from_addr),
        op:     mapOpType(t.op_type),
        result: EARN_OPS.has(t.op_type)
          ? (COMPLETE_AMOUNTS.has(Math.round(t._rawAmount)) ? 'completed' : 'busted')
          : 'ok',
        dirty:  t.kind === 'MINT'
          ? Math.round(t._rawAmount * 100) / 100
          : -Math.round(t._rawAmount * 100) / 100,
        count:  t._count,
        inf:    infCost,
        _ts:    Number(t.timestamp),
      }));

    // ── live counter seed ─────────────────────────────────────────────────────
    const counterInit = {
      block:  latestBlock ?? 0,
      daw:    Number(todayActiveRow[0]?.cnt ?? 0),
      opsMin: Number(recentOpsRow[0]?.cnt ?? 0),
      dirty:  dirtyPrice,
      opCost: infCost,
      gas:    0.001,
    };

    // ── apps (static — no DB data needed) ────────────────────────────────────
    const apps = [
      { id: 'offshore',    name: 'Offshore',      tag: 'GAME',    active: true,  glyph: 'OF' },
      { id: 'euphoria',    name: 'Euphoria',       tag: 'PERP',    active: false, glyph: 'EU' },
      { id: 'topstrike',   name: 'TopStrike',      tag: 'PREDICT', active: false, glyph: 'TS' },
      { id: 'blackhaven',  name: 'BlackHaven',     tag: 'LEND',    active: false, glyph: 'BH' },
      { id: 'sirtrading',  name: 'SirTrading',     tag: 'AGENT',   active: false, glyph: 'ST' },
      { id: 'mnstr',       name: 'mnstr.xyz',      tag: 'GAME',    active: false, glyph: 'MN' },
      { id: 'ubitel',      name: 'Ubitel',         tag: 'SOCIAL',  active: false, glyph: 'UB' },
      { id: 'aave',        name: 'Aave',           tag: 'LEND',    active: false, glyph: 'AV' },
      { id: 'worldmarket', name: 'WorldMarket',    tag: 'TRADE',   active: false, glyph: 'WM' },
      { id: 'mega',        name: 'Mega · Wallets', tag: 'INDEX',   active: false, glyph: 'M*', isMeta: true },
    ];

    // ── wallet (demo wallet — real data from DB) ─────────────────────────────
    const ws = walletStats[0] || {};
    const wEarned = ws.dirty_earned || 0;
    const wSpent  = ws.dirty_spent  || 0;

    const opLabelMap  = { DRUG_DEAL: 'Drug Deal', ARMS_DEAL: 'Arms Deal', PARTIAL: 'Op', SCRAP: 'Scrap Item', EXTORTION: 'Extortion' };
    const opColorMap  = { DRUG_DEAL: 'green', ARMS_DEAL: 'green', PARTIAL: 'dim', EXTORTION: 'green', SCRAP: 'orange' };
    const spnLabelMap = { BUY_ASSET: 'Buy Asset', LEVEL_UP: 'Level Up', THIRD_ENTERPRISE: 'Third Enterprise' };
    const spnColorMap = { BUY_ASSET: 'orange', LEVEL_UP: 'magenta', THIRD_ENTERPRISE: 'red' };

    const earnedByOp = walletEarnedByOp.map(r => ({
      type:  opLabelMap[r.op_type] || r.op_type,
      ops:   r.ops,
      dirty: fmtM(r.dirty),
      share: wEarned > 0 ? Math.round(r.dirty / wEarned * 1000) / 10 : 0,
      color: opColorMap[r.op_type] || 'green',
    }));

    const spentByOp = walletSpentByOp.map(r => ({
      type:  spnLabelMap[r.op_type] || r.op_type,
      count: r.ops,
      dirty: fmtM(r.dirty),
      share: wSpent > 0 ? Math.round(r.dirty / wSpent * 1000) / 10 : 0,
      color: spnColorMap[r.op_type] || 'red',
    }));

    const dayEarned = Object.fromEntries(walletFarmedEarned.map(r => [r.day_ts, r.earned]));
    const daySpent  = Object.fromEntries(walletFarmedSpent.map(r => [r.day_ts, r.spent]));
    const allDays   = [...new Set([
      ...walletFarmedEarned.map(r => r.day_ts),
      ...walletFarmedSpent.map(r => r.day_ts),
    ])].sort((a, b) => a - b);
    const farmedDaily = allDays.slice(-14).map(ts => ({
      ts: Number(ts), x: fmtDate(ts),
      earned: Math.round(dayEarned[ts] || 0),
      spent:  Math.round(daySpent[ts]  || 0),
    }));

    const wallet = {
      address: shortAddr(DEMO_WALLET),
      indexed: {
        totalOps:          ws.total_ops              || 0,
        dirtyEarned:       fmtM(wEarned),
        dirtySpent:        fmtM(wSpent),
        infBought:         Math.round(ws.inf_bought_total      || 0),
        infBoughtPurchases: ws.inf_bought_purchases  || 0,
        infRefunded:       Math.round(ws.inf_refunded          || 0),
        dexSold:           fmtM(ws.dex_sold          || 0),
        dexSoldTxs:        ws.dex_sold_txs           || 0,
        dexBought:         fmtM(ws.dex_bought        || 0),
        dexBoughtTxs:      ws.dex_bought_txs         || 0,
        vaultClaimed:      `$${(ws.vault_claimed || 0).toFixed(2)}`,
        vaultPayouts:      ws.vault_payouts          || 0,
        balance:           fmtM(ws.balance           || 0),
      },
      earnedByOp,
      spent: spentByOp,
      farmedDaily,
    };

    const onChainStrip = {
      influence:      0,
      dirtyBal:       fmtM(ws.balance || 0),
      opCost:         `${infCost.toFixed(2)} INF`,
      companies:      companyStats.total,
      activeCompanies: companyStats.activeCount,
      autoCompanies:  companyStats.autoTradeCount,
      status:         'OK',
    };

    // ── leaderboard ───────────────────────────────────────────────────────────
    // Filter out protocol/treasury addresses (very few ops but massive earned)
    const filteredLeaderboard = rawLeaderboard.filter(r => r.ops >= 10);
    const leaderboard = filteredLeaderboard.slice(0, 12).map((r, i) => {
      const net = (r.earned || 0) - (r.spent || 0);
      const netStr = net >= 0 ? `+${fmtM(net)}` : `−${fmtM(Math.abs(net))}`;
      // Deterministic spark: ascending from ~20% to 100% of final value, seeded by addr
      let seed = 0;
      for (const ch of (r.addr || '')) seed = ((seed * 31) + ch.charCodeAt(0)) >>> 0;
      const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const spark = Array.from({ length: 12 }, (_, j) => {
        const t = j / 11;
        return Math.max(1, Math.round((0.15 + t * 0.85 + (rng() - 0.5) * 0.15) * 70));
      });
      return {
        wallet:     shortAddr(r.addr),
        walletFull: r.addr,
        ops:        r.ops,
        earned:     fmtM(r.earned),
        net:        netStr,
        rank:       0,
        spark,
      };
    });

    const currentWorldTime = cycleHistory.length > 0 ? cycleHistory.at(-1).t : 'Q4 2012';

    const result = {
      hero, supplyOverTime, marketCapChart, emissionsVsBurn, emissionsVsBurnDaily, influenceFlow,
      burnedDaily, newParticipants, newParticipantsTotal, totalPlayersChart,
      dailyActiveWallets, dailyActiveWalletsPeak,
      usdmPerCycle, recipientsPerCycle, newRecipientsPerCycle, distributionTotals,
      currentWorldTime,
      companies: companiesData, liveTrades, onChainStrip, wallet,
      heatmap: heatmapGrid, heatmapDays, heatmapDayTs,
      liveTradeTicker, apps,
      recentOps,
      counterInit,
      leaderboard,
      priceBase25h,
      infCostHistory: (infHistRows || []).map(r => ({ v: Number(r.v), t: Number(r.t) })),
      opsMatrix: (() => {
        const keyMap = { DRUG_DEAL: 'drugs', ARMS_DEAL: 'arms', EXTORTION: 'extortion' };
        const windows = ['m1', 'm5', 'm15', 'm30', 'm60'];
        const result = { drugs: {m1:0,m5:0,m15:0,m30:0,m60:0}, arms: {m1:0,m5:0,m15:0,m30:0,m60:0}, extortion: {m1:0,m5:0,m15:0,m30:0,m60:0} };
        for (const row of (opsMatrixRows || [])) {
          const key = keyMap[row.op_type];
          if (key) for (const w of windows) result[key][w] = Number(row[w] ?? 0);
        }
        return result;
      })(),
    };

    _cache = result; _cacheTs = Date.now();
    return new NextResponse(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  } catch (err) {
    console.error('[offshore-data]', err);
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
