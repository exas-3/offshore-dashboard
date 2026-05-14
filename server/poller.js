import {
  fetchTransferLogs, fetchSupply, fetchSupplyAtBlock,
  fetchEthPrice, fetchDirtyPrice, fetchLatestInfCost,
  checkIsContract, getLatestBlock,
  classifyTransfer, fetchTxInputs, FUNCTION_OP_TYPES,
  DIRTY, INFLUENCE, USDM, VAULT,
  getUserCompaniesBatch, getTradeStates,
  fetchLiquidationEvents,
  fetchFactoryTradeContext, getCompanyTradeTypes, _companyTypeCache,
} from './etherscan.js';
import {
  getDb,
  upsertTransfers, getLastBlock, setLastBlock,
  saveTokenInfoSnapshot, saveEthPriceSnapshot, saveInfluenceSupply,
  savePriceSnapshot, cleanupOldEthPrices,
  upsertHolders, computeHolderBalances, getKnownIsContract, computeTrueHolderCount,
  getDaysNeedingSupplyBackfill, getHoursNeedingSupplyBackfill,
  upsertInfluenceTransfers, getLastInfluenceBlock, setLastInfluenceBlock,
  upsertVaultPayouts, getLastVaultBlock, setLastVaultBlock,
  getAllPlayerAddresses, upsertCompanies,
  getDistinctMintHashes, batchUpdateMintOpTypes,
  getLastLiqBlock, setLastLiqBlock, syncLiquidationsFromIdx,
  reconcileStatus,
} from '../lib/db.js';

const TX_INTERVAL_MS        = 15_000;
const SNAPSHOT_INTERVAL_MS  = 60_000;
const HOLDERS_INTERVAL_MS   = 15 * 60_000;
const COMPANIES_INTERVAL_MS = 2 * 60_000;

const DIRTY_START     = 15_190_000;
const INFLUENCE_START = 15_194_000;
const VAULT_START     = 15_194_000;
const BATCH           = 20_000;

// ─── transfer sync ────────────────────────────────────────────────────────────

let syncing = false;

async function syncTransfers() {
  if (syncing) return;
  syncing = true;
  try {
    const fromBlock   = Math.max(await getLastBlock() + 1, DIRTY_START);
    const latestBlock = await getLatestBlock();
    if (fromBlock > latestBlock) return;

    let total = 0;
    for (let start = fromBlock; start <= latestBlock; start += BATCH) {
      const end = Math.min(start + BATCH - 1, latestBlock);
      let attempt = 0;
      while (attempt < 4) {
        try {
          const logs = await fetchTransferLogs(DIRTY, start, end);
          if (logs.length > 0) {
            // Fetch tx inputs for MINT events to detect non-mission ops (scrapInventoryItem, etc.)
            const mintHashes = [...new Set(
              logs.filter(l => l.fromAddr === '0x0000000000000000000000000000000000000000')
                  .map(l => l.hash.toLowerCase())
            )];
            const [txInputs, tradeCtx] = await Promise.all([
              fetchTxInputs(mintHashes).catch(() => new Map()),
              fetchFactoryTradeContext(start, end).catch(() => ({ companyMap: new Map(), fullTxs: new Set() })),
            ]);
            // Pre-fetch trade types for companies seen in this batch
            const companyAddrs = [...new Set([...tradeCtx.companyMap.values()])];
            if (companyAddrs.length > 0) {
              await getCompanyTradeTypes(companyAddrs).catch(() => {});
            }
            const rows = logs.map(t => {
              const classified = { ...t, rawValue: t.amount.toString(), ...classifyTransfer(t.fromAddr, t.toAddr, t.amount, txInputs.get(t.hash.toLowerCase())) };
              // Override PARTIAL classification using factory event context
              if (classified.kind === 'MINT' && classified.opType === 'PARTIAL') {
                const txh = t.hash.toLowerCase();
                const company = tradeCtx.companyMap.get(txh);
                if (company) {
                  const isFull = tradeCtx.fullTxs.has(txh);
                  if (isFull) {
                    const compType = _companyTypeCache.get(company) ?? 0;
                    classified.opType = compType === 1 ? 'DRUG_DEAL' : compType === 2 ? 'ARMS_DEAL' : 'PARTIAL';
                  } // else: stays PARTIAL (early collection)
                }
              }
              return classified;
            });
            await upsertTransfers(rows);
            total += rows.length;
          }
          break;
        } catch (err) {
          attempt++;
          if (attempt >= 4) throw err;
          await new Promise(r => setTimeout(r, 2000 * attempt));
          console.log(`[poller] DIRTY rate-limit, retry ${attempt}...`);
        }
      }
      await new Promise(r => setTimeout(r, 1200));
    }

    await setLastBlock(latestBlock);
    if (total > 0) console.log(`[poller] DIRTY +${total} | block ${latestBlock}`);
  } catch (err) {
    console.error('[poller] transfer sync error:', err.message);
  } finally {
    syncing = false;
  }
}

let influenceSyncing = false;

async function syncInfluence() {
  if (influenceSyncing) return;
  influenceSyncing = true;
  try {
    const fromBlock   = Math.max(await getLastInfluenceBlock() + 1, INFLUENCE_START);
    const latestBlock = await getLatestBlock();
    if (fromBlock > latestBlock) return;

    let total = 0;
    for (let start = fromBlock; start <= latestBlock; start += BATCH) {
      const end = Math.min(start + BATCH - 1, latestBlock);
      let attempt = 0;
      while (attempt < 4) {
        try {
          const rows = await fetchTransferLogs(INFLUENCE, start, end);
          if (rows.length > 0) { await upsertInfluenceTransfers(rows); total += rows.length; }
          break;
        } catch (err) {
          attempt++;
          if (attempt >= 4) throw err;
          await new Promise(r => setTimeout(r, 2000 * attempt));
          console.log(`[poller] influence rate-limit, retry ${attempt}...`);
        }
      }
      await new Promise(r => setTimeout(r, 1200));
    }

    await setLastInfluenceBlock(latestBlock);
    if (total > 0) console.log(`[poller] influence +${total} | block ${latestBlock}`);
  } catch (err) {
    console.error('[poller] influence sync error:', err.message);
  } finally {
    influenceSyncing = false;
  }
}

// ─── snapshots ────────────────────────────────────────────────────────────────

async function syncSnapshots() {
  try {
    const [dirtySupply, infSupply, ethPrice, dirtyPrice, infCost] = await Promise.allSettled([
      fetchSupply(DIRTY),
      fetchSupply(INFLUENCE),
      fetchEthPrice(),
      fetchDirtyPrice(),
      fetchLatestInfCost(),
    ]);

    if (dirtySupply.status === 'fulfilled') {
      const holders = await computeTrueHolderCount();
      await saveTokenInfoSnapshot(dirtySupply.value, holders || null);
      console.log(`[poller] supply=${dirtySupply.value.toFixed(0)} holders=${holders}`);
    } else {
      console.error('[poller] supply error:', dirtySupply.reason.message);
    }

    if (infSupply.status === 'fulfilled') {
      await saveInfluenceSupply(infSupply.value);
    } else {
      console.error('[poller] influence supply error:', infSupply.reason.message);
    }

    if (ethPrice.status === 'fulfilled') {
      await saveEthPriceSnapshot(ethPrice.value);
    } else {
      console.error('[poller] eth price error:', ethPrice.reason.message);
    }

    const d = dirtyPrice.status === 'fulfilled' ? dirtyPrice.value : null;
    const i = infCost.status   === 'fulfilled' ? infCost.value   : null;
    if (d != null || i != null) {
      await savePriceSnapshot(d, i);
      console.log(`[poller] prices dirty=${d?.toFixed(4)} inf=${i?.toFixed(2)}`);
    }

    await cleanupOldEthPrices();
  } catch (err) {
    console.error('[poller] snapshot error:', err.message);
  }
}

// ─── holders ──────────────────────────────────────────────────────────────────

async function syncHolders() {
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
    console.error('[poller] holders sync error:', err.message);
  }
}

// ─── vault sync ───────────────────────────────────────────────────────────────

let vaultSyncing = false;

async function syncVault() {
  if (vaultSyncing) return;
  vaultSyncing = true;
  try {
    const fromBlock   = Math.max(await getLastVaultBlock() + 1, VAULT_START);
    const latestBlock = await getLatestBlock();
    if (fromBlock > latestBlock) return;

    let total = 0;
    for (let start = fromBlock; start <= latestBlock; start += BATCH) {
      const end = Math.min(start + BATCH - 1, latestBlock);
      let attempt = 0;
      while (attempt < 4) {
        try {
          const logs    = await fetchTransferLogs(USDM, start, end);
          const payouts = logs.filter(l => l.fromAddr.toLowerCase() === VAULT.toLowerCase());
          if (payouts.length > 0) {
            const rows = payouts.map(l => ({
              hash: l.hash, logIndex: l.logIndex, blockNum: l.blockNum,
              timestamp: l.timestamp, recipient: l.toAddr, amount: l.amount,
            }));
            await upsertVaultPayouts(rows);
            total += rows.length;
          }
          break;
        } catch (err) {
          attempt++;
          if (attempt >= 4) throw err;
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
      await new Promise(r => setTimeout(r, 1200));
    }

    await setLastVaultBlock(latestBlock);
    if (total > 0) console.log(`[poller] vault +${total} payouts | block ${latestBlock}`);
  } catch (err) {
    console.error('[poller] vault sync error:', err.message);
  } finally {
    vaultSyncing = false;
  }
}

// ─── supply history backfill ──────────────────────────────────────────────────

async function backfillSupplyHistory() {
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

// ─── companies ────────────────────────────────────────────────────────────────

export async function syncCompanies() {
  try {
    const wallets = await getAllPlayerAddresses(10000);
    if (!wallets.length) return;

    // Batch getUserCompanies in chunks of 50
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

    // Fetch trade states in chunks of 100
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

// ─── targeted mint reclassification ──────────────────────────────────────────
// Re-fetches tx inputs only for MINT rows whose op_type may be wrong
// (PARTIAL/FAIL misclassified as SCRAP_ITEM, or unknown op_types).
// Much faster than full reconcile since it skips non-MINT blocks.

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

// ─── liquidation sync ─────────────────────────────────────────────────────────
// Fetches factory TradeExited events via RPC (primary) and inserts FAIL records
// into transfers. Falls back to idx_logs for any gap the RPC path missed.

const LIQ_INTERVAL_MS = 60_000;
const LIQ_START       = 15_190_000;
let liqSyncing = false;

async function syncLiquidations() {
  if (liqSyncing) return;
  liqSyncing = true;
  try {
    const fromBlock   = Math.max(await getLastLiqBlock() + 1, LIQ_START);
    const latestBlock = await getLatestBlock();
    if (fromBlock > latestBlock) return;

    let total = 0;
    for (let start = fromBlock; start <= latestBlock; start += BATCH) {
      const end  = Math.min(start + BATCH - 1, latestBlock);
      const liqs = await fetchLiquidationEvents(start, end).catch(() => []);
      if (liqs.length > 0) {
        const rows = liqs.map(l => ({
          hash: l.hash, logIndex: l.logIndex, blockNum: l.blockNum,
          timestamp: l.timestamp, fromAddr: '0x0000000000000000000000000000000000000000',
          toAddr: l.companyAddr, rawValue: '0', amount: 0,
          kind: 'MINT', opType: 'FAIL',
        }));
        await upsertTransfers(rows);
        total += rows.length;
      }
      await new Promise(r => setTimeout(r, 400));
    }

    await setLastLiqBlock(latestBlock);
    if (total > 0) console.log(`[poller] liquidations +${total} | block ${latestBlock}`);
  } catch (err) {
    console.error('[poller] liquidation sync error:', err.message);
  } finally {
    liqSyncing = false;
  }
}

// ─── reconcile ────────────────────────────────────────────────────────────────

let reconciling = false;
export { reconcileStatus };

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
  await Promise.all([syncTransfers(), syncInfluence(), syncVault(), syncLiquidations()]);
  await backfillSupplyHistory().catch(err => console.error('[poller] backfill error:', err.message));
  syncSnapshots();
  syncHolders();
  syncCompanies();
  setInterval(syncInfluence,    TX_INTERVAL_MS);
  setInterval(syncTransfers,    TX_INTERVAL_MS);
  setInterval(syncVault,        TX_INTERVAL_MS);
  setInterval(syncLiquidations, LIQ_INTERVAL_MS);
  setInterval(syncSnapshots,    SNAPSHOT_INTERVAL_MS);
  setInterval(syncHolders,      HOLDERS_INTERVAL_MS);
  setInterval(syncCompanies,    COMPANIES_INTERVAL_MS);
  setInterval(() => backfillSupplyHistory().catch(() => {}), 60 * 60_000);
}
