export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../../lib/index.js';
import { getLatestEthPrice } from '../../../../lib/db.js';
import { fetchDirtyPrice, fetchLatestInfCost, getLatestBlock, fetchTps } from '../../../../server/etherscan.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr ?? '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function mapOpType(opType) {
  const m = {
    DRUG_DEAL: 'drug-deal', ARMS_DEAL: 'arms-deal', EXTORTION: 'extortion',
    PARTIAL: 'op', SCRAP: 'scrap', BUY_ASSET: 'buy-asset',
    LEVEL_UP: 'level-up', THIRD_ENTERPRISE: 'buy-asset',
  };
  return m[opType] ?? opType.toLowerCase().replace(/_/g, '-');
}

const EARN_OPS = new Set(['DRUG_DEAL', 'ARMS_DEAL', 'EXTORTION', 'PARTIAL']);
const COMPLETE_AMOUNTS = new Set([100, 115, 130]);

export async function GET(request) {
  try {
    const since = Number(new URL(request.url).searchParams.get('since') || '0');
    const now   = Math.floor(Date.now() / 1000);
    const db    = getDb();

    const [dirtyPrice, infCost, latestBlock, tps, ethFromDb, dawRow, opsRow, latestOpRow, newOpsRows, latestEventRow] = await Promise.all([
      fetchDirtyPrice().catch(() => null),
      fetchLatestInfCost().catch(() => null),
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
        (SELECT to_addr AS addr, NULL AS from_addr2, op_type, amount::float AS amount, timestamp, 'MINT' AS kind
          FROM transfers WHERE kind='MINT' AND timestamp > ${since}
            AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','SCRAP')
          ORDER BY timestamp ASC LIMIT 20)
        UNION ALL
        (SELECT NULL, from_addr, op_type, amount::float, timestamp, 'SPEND'
          FROM transfers WHERE kind='SPEND' AND timestamp > ${since}
            AND op_type IN ('BUY_ASSET','LEVEL_UP','THIRD_ENTERPRISE')
          ORDER BY timestamp ASC LIMIT 10)
        ORDER BY timestamp ASC LIMIT 20
      `.catch(() => []) : Promise.resolve([]),
      db ? db`
        (SELECT 'DEX_SELL' AS etype, from_addr AS addr, amount, timestamp
          FROM transfers WHERE kind='TRANSFER' AND op_type='DEX_SELL' AND amount >= 1000
          ORDER BY timestamp DESC LIMIT 1)
        UNION ALL
        (SELECT 'DEX_BUY', to_addr, amount, timestamp
          FROM transfers WHERE kind='TRANSFER' AND op_type='DEX_BUY' AND amount >= 1000
          ORDER BY timestamp DESC LIMIT 1)
        UNION ALL
        (SELECT op_type, to_addr, amount, timestamp
          FROM transfers WHERE kind='MINT'
            AND op_type IN ('DRUG_DEAL','ARMS_DEAL','EXTORTION','PARTIAL','SCRAP')
          ORDER BY timestamp DESC LIMIT 1)
        UNION ALL
        (SELECT op_type, from_addr, amount, timestamp
          FROM transfers WHERE kind='SPEND'
            AND op_type IN ('BUY_ASSET','LEVEL_UP','THIRD_ENTERPRISE')
          ORDER BY timestamp DESC LIMIT 1)
        ORDER BY timestamp DESC LIMIT 1
      `.catch(() => []) : Promise.resolve([]),
    ]);

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
    const newOps = (newOpsRows || []).map(r => ({
      wallet: shortAddr(r.kind === 'MINT' ? r.addr : r.from_addr2),
      op:     mapOpType(r.op_type),
      result: EARN_OPS.has(r.op_type)
        ? (COMPLETE_AMOUNTS.has(Math.round(Number(r.amount))) ? 'completed' : 'busted')
        : 'ok',
      dirty:  r.kind === 'MINT'
        ? Math.round(Number(r.amount) * 100) / 100
        : -Math.round(Number(r.amount) * 100) / 100,
      inf:    ic,
      _ts:    Number(r.timestamp),
    }));

    const tickerKind  = { DEX_SELL:'sell', DEX_BUY:'buy', DRUG_DEAL:'op', ARMS_DEAL:'op', EXTORTION:'op', PARTIAL:'op', SCRAP:'op', BUY_ASSET:'op', LEVEL_UP:'op', THIRD_ENTERPRISE:'op' };
    const tickerLabel = { DEX_SELL:'DEX SELL', DEX_BUY:'DEX BUY', DRUG_DEAL:'DRUG DEAL', ARMS_DEAL:'ARMS DEAL', EXTORTION:'EXTORTION', PARTIAL:'OP', SCRAP:'SCRAP', BUY_ASSET:'BUY ASSET', LEVEL_UP:'LEVEL UP', THIRD_ENTERPRISE:'3RD ENTERPRISE' };

    const ev = latestEventRow[0];
    const latestEvent = ev ? {
      kind:   tickerKind[ev.etype]  || 'op',
      label:  tickerLabel[ev.etype] || ev.etype,
      amount: (Math.abs(Number(ev.amount)) >= 1e6 ? (Number(ev.amount)/1e6).toFixed(2)+'M' : Math.abs(Number(ev.amount)) >= 1e3 ? (Number(ev.amount)/1e3).toFixed(1)+'k' : String(Math.round(Number(ev.amount)))),
      token:  '$DIRTY',
      addr:   shortAddr(ev.addr),
      _ts:    Number(ev.timestamp),
    } : null;

    return new NextResponse(JSON.stringify({
      block:       latestBlock ?? null,
      tps:         tps ?? null,
      dirty:       dirtyPrice ?? null,
      opCost:      typeof infCost === 'number' ? infCost : null,
      eth:         ethFromDb ?? null,
      gas:         0.001,
      daw:         Number(dawRow[0]?.cnt ?? 0),
      opsMin:      Number(opsRow[0]?.cnt ?? 0),
      latestOp,
      newOps,
      latestEvent,
    }), { headers: { 'Content-Type': 'application/json', ...CORS } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
