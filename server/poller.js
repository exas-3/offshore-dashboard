import {
  fetchTransferLogs, fetchTxInputs, classifyTransfer, FUNCTION_OP_TYPES, DIRTY, getLatestBlock,
} from './etherscan.js';
import {
  getDistinctMintHashes, batchUpdateMintOpTypes, upsertTransfers,
} from '../lib/index.js';
import { syncTransfers, startTransfersWs, backfillSupplyHistory } from './syncs/transfers.js';
import { syncInfluence } from './syncs/influence.js';
import { syncSnapshots } from './syncs/snapshots.js';
import { syncHolders } from './syncs/holders.js';
import { syncVault } from './syncs/vault.js';
import { syncCompanies } from './syncs/companies.js';
import { syncCompanyStarts, startCompanyStartsWs, COMPANY_STARTS_INTERVAL_MS } from './syncs/company-starts.js';
import { getWsClient } from './etherscan/ws-client.js';
import { syncPartialSweep, PARTIAL_SWEEP_INTERVAL_MS } from './syncs/partial-sweep.js';
import { syncLiquidations, startLiquidationsWs, LIQ_INTERVAL_MS } from './syncs/liquidations.js';
import { syncStaking, syncStakingClaims, syncStakingRotations } from './syncs/staking.js';

// Job status (mutated by the long-running reconcile/reclassify jobs, read by admin routes).
// Lives here because both the mutators and the API consumers run in the Next.js process.
export const reconcileStatus = { running: false, done: 0, total: 0, added: 0, error: null };

// TX polling: was 15s when polling-only. With WS as the fast path, this
// runs as a safety-net catch-up — 60s leaves plenty of room to fill any
// brief WS-disconnect gaps without piling RPC.
const TX_INTERVAL_MS        = 60_000;
const SNAPSHOT_INTERVAL_MS  = 60_000;
const HOLDERS_INTERVAL_MS   = 15 * 60_000;
const COMPANIES_INTERVAL_MS = 2 * 60_000;

const DIRTY_START = 15_190_000;
const BATCH       = 20_000;

// ─── targeted mint reclassification ──────────────────────────────────────────

let reclassifying = false;
export const reclassifyStatus = { running: false, done: 0, total: 0, updated: 0, error: null };

export async function reclassifyMintTransfers() {
  if (reclassifying) return;
  reclassifying = true;
  Object.assign(reclassifyStatus, { running: true, done: 0, total: 0, updated: 0, error: null });
  try {
    const hashes = await getDistinctMintHashes();
    reclassifyStatus.total = hashes.length;
    console.log(`[reclassify] re-checking ${hashes.length} unique MINT tx hashes`);

    const CHUNK = 100;
    let updated = 0;
    for (let i = 0; i < hashes.length; i += CHUNK) {
      const chunk    = hashes.slice(i, i + CHUNK);
      const inputMap = await fetchTxInputs(chunk).catch(() => new Map());
      const toUpdate = new Map();
      for (const [hash, input] of inputMap) {
        const sel     = input.slice(0, 10).toLowerCase();
        const knownOp = FUNCTION_OP_TYPES[sel];
        if (knownOp) toUpdate.set(hash, knownOp);
      }
      if (toUpdate.size > 0) {
        updated += await batchUpdateMintOpTypes(toUpdate);
      }
      reclassifyStatus.done    = i + chunk.length;
      reclassifyStatus.updated = updated;
      if (i + CHUNK < hashes.length) await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[reclassify] done — updated ${updated} MINT rows`);
    Object.assign(reclassifyStatus, { running: false, done: hashes.length, total: hashes.length, updated, error: null });
  } catch (err) {
    console.error('[reclassify] error:', err.message);
    Object.assign(reclassifyStatus, { ...reclassifyStatus, running: false, error: err.message });
  } finally {
    reclassifying = false;
  }
}

// ─── reconcile ────────────────────────────────────────────────────────────────

let reconciling = false;

export async function reconcileDirtyTransfers() {
  if (reconciling) return;
  reconciling = true;
  Object.assign(reconcileStatus, { running: true, done: 0, total: 0, added: 0, error: null });
  try {
    const latestBlock = await getLatestBlock();
    const batches = Math.ceil((latestBlock - DIRTY_START + 1) / BATCH);
    reconcileStatus.total = batches;
    console.log(`[reconcile] scanning ${batches} batches from block ${DIRTY_START} to ${latestBlock}`);

    let added = 0;
    for (let start = DIRTY_START; start <= latestBlock; start += BATCH) {
      const end = Math.min(start + BATCH - 1, latestBlock);
      let attempt = 0;
      while (attempt < 4) {
        try {
          const logs = await fetchTransferLogs(DIRTY, start, end);
          if (logs.length > 0) {
            const mintHashes = [...new Set(
              logs.filter(l => l.fromAddr === '0x0000000000000000000000000000000000000000')
                  .map(l => l.hash.toLowerCase())
            )];
            const txInputs = await fetchTxInputs(mintHashes).catch(() => new Map());
            const rows = logs.map(t => ({
              ...t,
              rawValue: t.amount.toString(),
              ...classifyTransfer(t.fromAddr, t.toAddr, t.amount, txInputs.get(t.hash.toLowerCase())),
            }));
            await upsertTransfers(rows);
            added += logs.length;
          }
          break;
        } catch (err) {
          attempt++;
          if (attempt >= 4) throw err;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
      reconcileStatus.done++;
      reconcileStatus.added = added;
      await new Promise(r => setTimeout(r, 800));
    }

    console.log(`[reconcile] done — inserted ${added} new events`);
    Object.assign(reconcileStatus, { running: false, done: batches, total: batches, added, error: null });
  } catch (err) {
    console.error('[reconcile] error:', err.message);
    Object.assign(reconcileStatus, { ...reconcileStatus, running: false, error: err.message });
  } finally {
    reconciling = false;
  }
}

// ─── start ────────────────────────────────────────────────────────────────────

export async function startPoller() {
  console.log('[poller] starting...');
  await Promise.all([syncTransfers(), syncInfluence(), syncVault(), syncLiquidations(), syncStaking(), syncStakingClaims(), syncStakingRotations()]);
  await backfillSupplyHistory().catch(err => console.error('[poller] backfill error:', err.message));
  syncSnapshots();
  syncHolders();
  syncCompanies();
  syncCompanyStarts();
  syncPartialSweep();
  // Bring up the WS client and register live subscriptions.
  // No-op if ALCHEMY_WS_URL isn't set — polling fallback alone keeps running.
  startCompanyStartsWs();
  startTransfersWs();
  startLiquidationsWs();
  getWsClient().start();
  setInterval(syncInfluence,        TX_INTERVAL_MS);
  setInterval(syncTransfers,        TX_INTERVAL_MS);
  setInterval(syncVault,            TX_INTERVAL_MS);
  setInterval(syncLiquidations,     LIQ_INTERVAL_MS);
  setInterval(syncStaking,          TX_INTERVAL_MS);
  setInterval(syncStakingClaims,    TX_INTERVAL_MS);
  setInterval(syncStakingRotations, TX_INTERVAL_MS);
  setInterval(syncSnapshots,     SNAPSHOT_INTERVAL_MS);
  setInterval(syncHolders,       HOLDERS_INTERVAL_MS);
  setInterval(syncCompanies,     COMPANIES_INTERVAL_MS);
  setInterval(syncCompanyStarts, COMPANY_STARTS_INTERVAL_MS);
  setInterval(syncPartialSweep,  PARTIAL_SWEEP_INTERVAL_MS);
  setInterval(() => backfillSupplyHistory().catch(() => {}), 60 * 60_000);
}
