export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/index.js';
import { getLatestEthPrice } from '../../../../lib/index.js';
import { fetchDirtyPrice, fetchLatestInfCost, getLatestBlock, fetchTps } from '../../../../server/etherscan.js';
import { ethPriceFeed } from '../../../../lib/eth-price-feed.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr ?? '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function mapOpType(opType) {
  // PARTIAL / FAIL are legacy classifier fallbacks — surface them raw so
  // leftover rows are visible. Mirror app/api/offshore-data/helpers.js.
  const m = {
    DRUG_DEAL: 'drugs', ARMS_DEAL: 'arms', EXTORTION: 'extortion',
    SCRAP: 'scrap', BUY_ASSET: 'buy-asset',
    LEVEL_UP: 'level-up', THIRD_ENTERPRISE: 'buy-asset',
    LP_ADD: 'lp add', LP_REMOVE: 'lp remove',
  };
  return m[opType] ?? opType.toLowerCase().replace(/_/g, '-');
}

const EARN_OPS = new Set(['DRUG_DEAL', 'ARMS_DEAL', 'EXTORTION', 'PARTIAL', 'FAIL']);
const COMPLETE_AMOUNTS = new Set([100, 115, 130]);

let _dirtyPrice = null, _dirtyPriceTs = 0;
async function getCachedDirtyPrice() {
  if (_dirtyPrice !== null && Date.now() - _dirtyPriceTs < 3000) return _dirtyPrice;
  _dirtyPrice = await fetchDirtyPrice();
  _dirtyPriceTs = Date.now();
  return _dirtyPrice;
}

let _infCost = null, _infCostTs = 0;
async function getCachedInfCost() {
  if (_infCost !== null && Date.now() - _infCostTs < 3000) return _infCost;
  _infCost = await fetchLatestInfCost();
  _infCostTs = Date.now();
  return _infCost;
}

export async function GET(request) {
  try {
    const since = Number(new URL(request.url).searchParams.get('since') || '0');
    const now   = Math.floor(Date.now() / 1000);
    const db    = getDb();

    const [dirtyPrice, infCost, latestBlock, tps, ethFromDb, dawRow, opsRow, latestOpRow, newOpsRows, latestEventRow, companiesRow, activeOpsRow, companiesStatsRow, recentStartsRows, newLiqsRows] = await Promise.all([
      getCachedDirtyPrice().catch(() => null),
      getCachedInfCost().catch(() => null),
      getLatestBlock().catch(() => null),
      fetchTps().catch(() => null),
      getLatestEthPrice().catch(() => null),
      db ? db`
        SELECT COUNT(DISTINCT to_addr)::int AS cnt
        FROM transfers WHERE kind = 'MINT' AND timestamp >= ${now - 86400}
      `.catch(() => [{ cnt: 0 }]) : Promise.resolve([{ cnt: 0 }]),
      db ? db`
        SELECT COUNT(*)::int AS cnt
        FROM transfers WHERE kind = 'MINT' AND timestamp >= ${now - 60}
      `.catch(() => [{ cnt: 0 }]) : Promise.resolve([{ cnt: 0 }]),
      db ? db`
        SELECT to_addr, op_type, amount, timestamp FROM transfers
        WHERE kind = 'MINT' AND op_type != ''
        ORDER BY timestamp DESC, log_index DESC LIMIT 1
      `.catch(() => []) : Promise.resolve([]),
      // New ops since last poll
      db && since > 0 ? db`
        (SELECT hash, to_addr AS addr, NULL AS from_addr2, op_type, amount::float AS amount, timestamp, 'MINT' AS kind
          FROM transfers WHERE kind='MINT' AND timestamp > ${since}
            AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL','SCRAP')
          ORDER BY timestamp ASC LIMIT 60)
        UNION ALL
        (SELECT hash, NULL, from_addr, op_type, amount::float, timestamp, 'SPEND'
          FROM transfers WHERE kind='SPEND' AND timestamp > ${since}
            AND op_type IN ('BUY_ASSET','LEVEL_UP','THIRD_ENTERPRISE')
          ORDER BY timestamp ASC LIMIT 20)
        ORDER BY timestamp ASC LIMIT 60
      `.catch(() => []) : Promise.resolve([]),
      db ? db`
        (SELECT hash, 'DEX_SELL' AS etype, from_addr AS addr, amount, timestamp
          FROM transfers WHERE kind='TRANSFER' AND op_type='DEX_SELL' AND amount >= 1000
          ORDER BY timestamp DESC LIMIT 1)
        UNION ALL
        (SELECT hash, 'DEX_BUY', to_addr, amount, timestamp
          FROM transfers WHERE kind='TRANSFER' AND op_type='DEX_BUY' AND amount >= 1000
          ORDER BY timestamp DESC LIMIT 1)
        UNION ALL
        (SELECT hash, op_type, to_addr, amount, timestamp
          FROM transfers WHERE kind='MINT'
            AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','FAIL','SCRAP')
          ORDER BY timestamp DESC LIMIT 1)
        UNION ALL
        (SELECT hash, op_type, from_addr, amount, timestamp
          FROM transfers WHERE kind='SPEND'
            AND op_type IN ('BUY_ASSET','LEVEL_UP','THIRD_ENTERPRISE')
          ORDER BY timestamp DESC LIMIT 1)
        UNION ALL
        (SELECT NULL::text AS hash, 'STAKE' AS etype, user_addr AS addr, amount::numeric, timestamp
          FROM staking_deposits
          ORDER BY timestamp DESC LIMIT 1)
        ORDER BY timestamp DESC LIMIT 1
      `.catch(() => []) : Promise.resolve([]),
      db ? db`
        SELECT c.address, c.owner, c.liq_price, c.end_time, c.active, c.auto_trade,
               c.trade_type AS op_type
        FROM companies c
        WHERE c.active = TRUE
        ORDER BY c.end_time ASC NULLS LAST
      `.catch(() => []) : Promise.resolve([]),
      db ? db`SELECT COUNT(*)::int AS cnt FROM companies WHERE active = TRUE`.catch(() => []) : Promise.resolve([]),
      db ? db`
        SELECT COUNT(*)::int AS total,
               COUNT(DISTINCT owner)::int AS unique_owners,
               COUNT(*) FILTER (WHERE active AND auto_trade)::int AS auto_on
        FROM companies
      `.catch(() => []) : Promise.resolve([]),
      // Ops that started in the last 5 minutes: start_time = end_time - duration per trade_type.
      db ? db`
        SELECT * FROM (
          SELECT address, owner, end_time, trade_type, liq_price,
                 (end_time - (CASE trade_type
                                WHEN 'EXTORTION' THEN 300
                                WHEN 'ARMS_DEAL' THEN 1800
                                WHEN 'DRUG_DEAL' THEN 5400
                                ELSE 5400 END)) AS start_time
          FROM companies
          WHERE active = TRUE AND trade_type IS NOT NULL AND end_time > 0
        ) s
        WHERE start_time >= EXTRACT(EPOCH FROM now())::bigint - 300
        ORDER BY start_time DESC
      `.catch(() => []) : Promise.resolve([]),
      // Newly-liquidated positions since last poll
      db && since > 0 ? db`
        SELECT owner AS addr, liq_price, deactivated_at AS timestamp
        FROM companies
        WHERE deactivated_at > ${since}
        ORDER BY deactivated_at ASC LIMIT 10
      `.catch(() => []) : Promise.resolve([]),
    ]);

    const ethPrice = typeof ethFromDb === 'number' ? ethFromDb : 0;
    function liqPriceUsd(raw) {
      if (!raw || raw === '0') return 0;
      try { return Number(BigInt(raw) / 10n ** 12n) / 1e6; } catch { return 0; }
    }
    const liveTrades = (companiesRow || []).map(c => {
      const liq = liqPriceUsd(c.liq_price);
      return {
        id:         shortAddr(c.address),
        owner:      c.owner,
        ownerShort: shortAddr(c.owner),
        auto:     c.auto_trade,
        active:   c.active,
        endTime:  c.active ? Number(c.end_time) : null,
        liqPrice: liq,
        ethPrice,
        buffer:   Math.round((ethPrice - liq) * 100) / 100,
        opType:   c.op_type ? mapOpType(c.op_type) : '—',
      };
    });

    const op = latestOpRow[0];
    const latestOp = op ? {
      wallet: shortAddr(op.to_addr),
      op:     mapOpType(op.op_type),
      result: EARN_OPS.has(op.op_type)
        ? (COMPLETE_AMOUNTS.has(Math.round(Number(op.amount))) ? 'completed' : 'busted')
        : 'ok',
      dirty:  Math.round(Number(op.amount) * 100) / 100,
      inf:    typeof infCost === 'number' ? infCost : 12.41,
    } : null;

    const ic = typeof infCost === 'number' ? infCost : 12.41;
    // Deduplicate: same wallet + same tx → collapse into one entry (sum amounts)
    const dedupMap = new Map();
    for (const r of (newOpsRows || [])) {
      const wallet = r.kind === 'MINT' ? r.addr : r.from_addr2;
      const key = `${r.hash}:${wallet}:${r.op_type}`;
      if (dedupMap.has(key)) {
        dedupMap.get(key)._rawAmount += Number(r.amount);
        dedupMap.get(key)._count += 1;
      } else {
        dedupMap.set(key, { ...r, _rawAmount: Number(r.amount), _count: 1 });
      }
    }
    const dedupedRows = [...dedupMap.values()].sort((a, b) => Number(a.timestamp) - Number(b.timestamp)).slice(0, 20);
    const newOps = dedupedRows.map(r => ({
      hash:   r.hash,
      wallet: shortAddr(r.kind === 'MINT' ? r.addr : r.from_addr2),
      walletFull: (r.kind === 'MINT' ? r.addr : r.from_addr2),
      op:     mapOpType(r.op_type),
      result: EARN_OPS.has(r.op_type)
        ? (COMPLETE_AMOUNTS.has(Math.round(r._rawAmount)) ? 'completed' : 'busted')
        : 'ok',
      dirty:  r.kind === 'MINT'
        ? Math.round(r._rawAmount * 100) / 100
        : -Math.round(r._rawAmount * 100) / 100,
      count:  r._count,
      inf:    ic,
      _ts:    Number(r.timestamp),
    }));

    const tickerKind  = { DEX_SELL:'sell', DEX_BUY:'buy', DRUG_DEAL:'op', ARMS_DEAL:'op', EXTORTION:'op', SCRAP:'op', BUY_ASSET:'op', LEVEL_UP:'op', THIRD_ENTERPRISE:'op', STAKE:'stake' };
    const tickerLabel = { DEX_SELL:'DEX SELL', DEX_BUY:'DEX BUY', DRUG_DEAL:'DRUG DEAL', ARMS_DEAL:'ARMS DEAL', EXTORTION:'EXTORTION', SCRAP:'SCRAP', BUY_ASSET:'BUY ASSET', LEVEL_UP:'LEVEL UP', THIRD_ENTERPRISE:'3RD ENTERPRISE', STAKE:'STAKE' };

    const ev = latestEventRow[0];
    const latestEvent = ev ? {
      hash:     ev.hash ?? null,
      kind:     tickerKind[ev.etype]  || 'op',
      label:    tickerLabel[ev.etype] || ev.etype,
      amount:   (Math.abs(Number(ev.amount)) >= 1e6 ? (Number(ev.amount)/1e6).toFixed(2)+'M' : Math.abs(Number(ev.amount)) >= 1e3 ? (Number(ev.amount)/1e3).toFixed(1)+'k' : String(Math.round(Number(ev.amount)))),
      _amount:  Number(ev.amount),
      token:    '$DIRTY',
      addr:     shortAddr(ev.addr),
      addrFull: ev.addr,
      _ts:      Number(ev.timestamp),
    } : null;

    const newLiqs = (newLiqsRows || []).map(r => ({
      kind:     'liquidation',
      label:    'LIQUIDATED',
      addr:     shortAddr(r.addr),
      addrFull: r.addr,
      liqPrice: liqPriceUsd(r.liq_price),
      _ts:      Number(r.timestamp),
    }));

    const recentStarts = (recentStartsRows || []).map(r => ({
      company:    r.address,
      wallet:     shortAddr(r.owner),
      walletFull: r.owner,
      opType:     r.trade_type,
      startTime:  Number(r.start_time),
      endTime:    Number(r.end_time),
      liqPrice:   liqPriceUsd(r.liq_price),
    }));

    return new NextResponse(JSON.stringify({
      block:       latestBlock ?? null,
      tps:         tps ?? null,
      dirty:       dirtyPrice ?? null,
      opCost:      typeof infCost === 'number' ? infCost : null,
      eth:         ethPriceFeed.getLatest() ?? ethFromDb ?? null,
      gas:         0.001,
      daw:         Number(dawRow[0]?.cnt ?? 0),
      opsMin:      Number(opsRow[0]?.cnt ?? 0),
      activeOps:   Number(activeOpsRow[0]?.cnt ?? 0),
      companiesStats: (() => {
        const total       = Number(companiesStatsRow[0]?.total ?? 0);
        const autoOn      = Number(companiesStatsRow[0]?.auto_on ?? 0);
        const activeCount = Number(activeOpsRow[0]?.cnt ?? 0);
        return {
          totalCompanies:      total,
          uniqueOwners:        Number(companiesStatsRow[0]?.unique_owners ?? 0),
          activeTrades:        activeCount,
          autoTradeOn:         autoOn,
          autoTradeShareLabel: total > 0 ? `${Math.round(autoOn / total * 100)}% of all` : '0% of all',
        };
      })(),
      liveTrades,
      latestOp,
      newOps,
      newLiqs,
      latestEvent,
      recentStarts,
    }), { headers: { 'Content-Type': 'application/json', ...CORS } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
