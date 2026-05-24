import {
  fetchTransferLogs, parseTransferLog, fetchTxInputs, fetchFactoryTradeContext,
  fetchHitEvents,
  getCompanyTradeTypesFromStorage, classifyTransfer,
  fetchSupplyAtBlock, DIRTY, USDM, DEX_POOLS,
  TRADE_DURATIONS,
} from '../etherscan.js';
import { HITS, E_HIT_RESOLVED } from '../../lib/chain-constants.js';
import { getWsClient } from '../etherscan/ws-client.js';
import { bufferedFlush } from '../etherscan/buffered-flush.js';
import {
  getLastBlock, setLastBlock, upsertTransfers,
  upsertHits, retagHitCosts,
  getCompanyTradeTypesFromDb, getDb,
  getDaysNeedingSupplyBackfill, getHoursNeedingSupplyBackfill, saveTokenInfoSnapshot,
} from '../../lib/index.js';
import { runBlockSync } from './_run.js';

const DIRTY_START    = 15_190_000;
const ZERO_TX        = '0x0000000000000000000000000000000000000000';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const POOLS_LC       = new Set(DEX_POOLS.map(p => p.toLowerCase()));

// Shared batch processor. Both the polling sync (eth_getLogs) and the WS
// path (buffered log delivery) funnel through here, so classification +
// LP detection + upsert behave identically.
async function processTransferBatch({ start, end, prefetched }) {
  const logs = prefetched ?? await fetchTransferLogs(DIRTY, start, end);
  if (logs.length === 0) return 0;

  const mintHashes = [...new Set(
    logs.filter(l => l.fromAddr === ZERO_TX).map(l => l.hash.toLowerCase())
  )];
  // Pull USDM Transfers in the same block range — net DIRTY/USDM delta
  // per user tells swap (opposite signs) apart from LP add/remove (same
  // signs).
  const [txInputs, tradeCtx, usdmLogs, hitCtx] = await Promise.all([
    fetchTxInputs(mintHashes).catch(() => new Map()),
    fetchFactoryTradeContext(start, end).catch(() => ({ companyMap: new Map(), fullTxs: new Set(), companyBlockMap: new Map() })),
    fetchTransferLogs(USDM, start, end).catch(() => []),
    fetchHitEvents(start, end).catch(() => ({ hits: [], byTx: new Map() })),
  ]);
  // Persist hit records (separate table) — independent of transfers upsert.
  if (hitCtx.hits.length) await upsertHits(hitCtx.hits).catch(err => console.warn('[poller] upsertHits:', err.message));
  const usdmByTx = new Map();
  for (const u of usdmLogs) {
    const h = u.hash.toLowerCase();
    if (!usdmByTx.has(h)) usdmByTx.set(h, []);
    usdmByTx.get(h).push(u);
  }

  // Resolve trade types for every company that emitted a DirtyPaid /
  // TradeExited event in this range. We read slots 4/5 at blockNum-1 so
  // the company is still inside its active trade window. Duration →
  // op_type is unambiguous (300/1800/5400 → EXTORTION/ARMS/DRUG).
  const companyAddrs = [...tradeCtx.companyBlockMap.keys()];
  const typeMap = companyAddrs.length
    ? await getCompanyTradeTypesFromStorage(companyAddrs, tradeCtx.companyBlockMap).catch(() => new Map())
    : new Map();
  // DB fallback: any companies whose storage read failed (RPC throttling /
  // missing block / etc.) get their cached `trade_type` from the companies
  // table, populated periodically by syncCompanies. Resolves PARTIALs that
  // would otherwise pile up under rate-limit pressure.
  const missingAddrs = companyAddrs.filter(a => !typeMap.has(a));
  if (missingAddrs.length) {
    const dbMap = await getCompanyTradeTypesFromDb(missingAddrs).catch(() => new Map());
    for (const [a, t] of dbMap) typeMap.set(a, t);
  }

  const rows = logs.map(t => {
    const classified = { ...t, rawValue: t.amount.toString(), ...classifyTransfer(t.fromAddr, t.toAddr, t.amount, txInputs.get(t.hash.toLowerCase()), Number(t.timestamp)) };
    // Hit re-tag: a hit tx emits two MINTs — one to the attacker (stolen
    // 80%) and one to the victim (kept 20%). Re-tag these before the
    // PARTIAL → trade-type fallback runs, so they don't get mis-resolved
    // via the victim's company storage slots.
    if (classified.kind === 'MINT') {
      const hit = hitCtx.byTx.get(t.hash.toLowerCase());
      if (hit) {
        const to = (t.toAddr ?? '').toLowerCase();
        if (to === hit.attacker)    { classified.opType = 'HIT';        classified.result = classified.amount > hit.cost ? 'completed' : 'busted'; }
        else if (to === hit.victim) { classified.opType = 'HIT_REFUND'; classified.result = 'busted'; }
      }
    }
    if (classified.kind === 'MINT' && classified.opType === 'PARTIAL') {
      const txh = t.hash.toLowerCase();
      const company = tradeCtx.companyMap.get(txh + ':' + t.logIndex);
      const resolved = company ? typeMap.get(company.toLowerCase()) : null;
      if (resolved) classified.opType = resolved;
    }
    // Season 2 progressive partial payouts emit DirtyPaid + a small DIRTY
    // Transfer even on busted ops, so a DirtyPaid event alone no longer
    // implies "completed". True completions land on integer amounts that
    // are multiples of 5 in the 50–130 range:
    //   - Season 2: 50, 55, 60, … , 100 by Power Level
    //   - Season 1: 100, 115, 130 by company location
    // Anything fractional, sub-50, above 130, or not a multiple of 5 is
    // treated as a partial bust.
    if (classified.kind === 'MINT' && TRADE_DURATIONS[classified.opType] != null) {
      const amt = Number(classified.amount);
      const rounded = Math.round(amt);
      const integerish = Math.abs(amt - rounded) < 0.001;
      const isCompleted = integerish && rounded >= 50 && rounded <= 130 && rounded % 5 === 0;
      classified.result = isCompleted ? 'completed' : 'busted';
    }
    return classified;
  });

  // Post-pass: tell DEX swap apart from LP add/remove. For each row
  // currently tagged DEX_BUY / DEX_SELL, compute the user's net DIRTY +
  // USDM delta within the same tx; same signs → LP_ADD / LP_REMOVE;
  // opposite signs → genuine swap (keep tag).
  const dirtyByTx = new Map();
  for (const r of rows) {
    if (r.kind !== 'TRANSFER') continue;
    if (r.opType !== 'DEX_BUY' && r.opType !== 'DEX_SELL') continue;
    const h = r.hash.toLowerCase();
    if (!dirtyByTx.has(h)) dirtyByTx.set(h, []);
    dirtyByTx.get(h).push(r);
  }
  for (const r of rows) {
    if (r.kind !== 'TRANSFER') continue;
    if (r.opType !== 'DEX_BUY' && r.opType !== 'DEX_SELL') continue;
    const user = (r.opType === 'DEX_BUY' ? r.toAddr : r.fromAddr).toLowerCase();
    if (POOLS_LC.has(user)) continue; // user is another pool — inter-pool hop, skip
    const txh = r.hash.toLowerCase();
    let dDirty = 0;
    for (const d of dirtyByTx.get(txh) || []) {
      if (d.toAddr.toLowerCase()   === user) dDirty += Number(d.amount);
      if (d.fromAddr.toLowerCase() === user) dDirty -= Number(d.amount);
    }
    let dUsdm = 0;
    for (const u of usdmByTx.get(txh) || []) {
      if (u.toAddr.toLowerCase()   === user) dUsdm += Number(u.amount);
      if (u.fromAddr.toLowerCase() === user) dUsdm -= Number(u.amount);
    }
    if (dDirty > 0 && dUsdm > 0) r.opType = 'LP_REMOVE';
    else if (dDirty < 0 && dUsdm < 0) r.opType = 'LP_ADD';
    // else: opposite signs (or zero USDM delta) → genuine swap, leave as-is.
  }

  // Resilience pass: any rows still 'PARTIAL' after the storage/DB path
  // (e.g. fetchFactoryTradeContext was rate-limited and returned empty maps)
  // get a final pass against idx_logs → companies.trade_type. This is the
  // same SQL the bulk-resolve UPDATE uses; running it inline catches new
  // PARTIALs before they ever leave the sync.
  const stillPartial = rows.filter(r => r.kind === 'MINT' && r.opType === 'PARTIAL');
  if (stillPartial.length) {
    const hashes = [...new Set(stillPartial.map(r => r.hash.toLowerCase()))];
    const db = getDb();
    const resolved = await db`
      WITH p AS (SELECT unnest(${hashes}::text[]) AS hash)
      SELECT p.hash, l.log_index, lower('0x' || RIGHT(l.topic1, 40)) AS company,
             l.topic0 = '0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502' AS is_payout
      FROM p
      JOIN idx_logs l ON l.tx_hash = p.hash
        AND l.address = '0x619814a203ca441611cee02abf31986ca265dd35'
        AND l.topic0 IN ('0xa082f97b8bead66307ae367bd14b2366e03c2e963493a9f269501d884cd1a502',
                          '0xf20fbbc5dd518513b4b0381c1904c0751ca7493753ec53a73e651e8b79ee61ff')
    `.catch(() => []);
    if (resolved.length) {
      const byKey = new Map();  // (txHash, dirtyMintLogIndex) → company
      for (const r of resolved) {
        const mintIdx = r.is_payout ? Number(r.log_index) - 1 : Number(r.log_index);
        byKey.set(`${r.hash}:${mintIdx}`, r.company);
      }
      const companies = [...new Set([...byKey.values()])];
      const dbMap = await getCompanyTradeTypesFromDb(companies).catch(() => new Map());
      for (const r of stillPartial) {
        const c = byKey.get(`${r.hash.toLowerCase()}:${r.logIndex}`);
        if (!c) continue;
        const t = dbMap.get(c);
        if (t) r.opType = t;
      }
    }
  }
  await upsertTransfers(rows);
  // Retag the cost-burn that initiates each hit (separate or same tx).
  // Must run AFTER upsertTransfers so the burn row exists for SAME-tx hits.
  if (hitCtx.hits.length) {
    const n = await retagHitCosts(hitCtx.hits).catch(err => { console.warn('[poller] retagHitCosts:', err.message); return 0; });
    if (n) console.log(`[poller] retagged ${n} burns as HIT_COST`);
  }
  return rows.length;
}

// ── Polling path (safety net) ─────────────────────────────────────────────
// Cadence used to be 15 s; with the WS path live it can be slowed (the
// poller's TX_INTERVAL_MS knob controls this from server/poller.js).
export function syncTransfers(latestBlock) {
  return runBlockSync({
    name: 'DIRTY',
    getLast: getLastBlock,
    setLast: setLastBlock,
    fromStart: DIRTY_START,
    latestBlock,
    async processBatch(start, end) {
      return processTransferBatch({ start, end });
    },
  });
}

// ── WS path ───────────────────────────────────────────────────────────────
// Subscribe to live DIRTY Transfer events. Buffer them in a 1.5 s window
// and flush through processTransferBatch with the buffered logs as
// prefetched input — saves a redundant eth_getLogs call.
const wsBuffer = bufferedFlush({
  label:   'poller] DIRTY (ws)',
  flushMs: 1500,
  keyFn:   (l) => `${l.hash.toLowerCase()}:${l.logIndex}`,
  onFlush: async (logs) => {
    const blocks = logs.map(l => l.blockNum);
    const start  = Math.min(...blocks);
    const end    = Math.max(...blocks);
    const n = await processTransferBatch({ start, end, prefetched: logs });
    if (n) console.log(`[poller] DIRTY (ws): ${n} rows (blocks ${start}..${end})`);
  },
});

export function startTransfersWs() {
  const client = getWsClient();
  client.addSubscription({
    name: 'dirty-transfers',
    filter: { address: DIRTY.toLowerCase(), topics: [TRANSFER_TOPIC] },
    onLog: (rawLog) => {
      try {
        wsBuffer.push(parseTransferLog(rawLog));
      } catch (err) {
        console.warn('[poller] DIRTY (ws) parse failed:', err.message);
      }
    },
  });
}

// ── Hits WS path ──────────────────────────────────────────────────────────
// Subscribe to HitResolved on the HITS contract. On flush, re-run
// processTransferBatch over the affected block range — that path already
// fetches hits + classifies MINTs as HIT/HIT_REFUND + retags the cost burn
// as HIT_COST. Adding this in addition to the DIRTY WS subscription gives
// explicit, immediate processing of hit results (the DIRTY WS would still
// catch the same blocks, but the buffered flush windows are independent
// and this guarantees a hit shows up even if no DIRTY transfers were
// captured in the same WS window).
const hitsWsBuffer = bufferedFlush({
  label:   'poller] hits (ws)',
  flushMs: 1500,
  keyFn:   (b) => b, // de-dupe by block number
  onFlush: async (blocks) => {
    const start = Math.min(...blocks);
    const end   = Math.max(...blocks);
    const n = await processTransferBatch({ start, end });
    if (n) console.log(`[poller] hits (ws): processed ${n} rows (blocks ${start}..${end})`);
  },
});

export function startHitsWs() {
  const client = getWsClient();
  client.addSubscription({
    name: 'hits',
    filter: { address: HITS.toLowerCase(), topics: [E_HIT_RESOLVED] },
    onLog: (rawLog) => {
      try { hitsWsBuffer.push(parseInt(rawLog.blockNumber, 16)); } catch {}
    },
  });
}

// ── Supply history backfill (unchanged) ───────────────────────────────────
export async function backfillSupplyHistory() {
  let days, hours;
  try {
    days  = await getDaysNeedingSupplyBackfill();
    hours = await getHoursNeedingSupplyBackfill();
  } catch (err) {
    console.error('[poller] supply backfill skipped:', err.message);
    return;
  }
  const total = days.length + hours.length;
  if (total === 0) return;
  console.log(`[poller] backfilling supply history: ${days.length} days + ${hours.length} hours`);

  for (const { block_num, day_ts } of days) {
    try {
      const supply = await fetchSupplyAtBlock(block_num);
      await saveTokenInfoSnapshot(supply, null, day_ts);
      await new Promise(r => setTimeout(r, 80));
    } catch { /* block not in archive — skip */ }
  }
  for (const { block_num, hour_ts } of hours) {
    try {
      const supply = await fetchSupplyAtBlock(block_num);
      await saveTokenInfoSnapshot(supply, null, hour_ts);
      await new Promise(r => setTimeout(r, 80));
    } catch { /* block not in archive — skip */ }
  }
  console.log('[poller] supply history backfill done');
}
