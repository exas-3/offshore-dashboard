import {
  fetchTransferLogs, fetchSupply, fetchSupplyAtBlock,
  fetchEthPrice, checkIsContract, getLatestBlock,
  classifyTransfer, DIRTY, INFLUENCE, USDM, VAULT,
} from './etherscan.js';
import {
  getDb,
  upsertTransfers, getLastBlock, setLastBlock,
  saveTokenInfoSnapshot, saveEthPriceSnapshot, saveInfluenceSupply,
  upsertHolders, computeHolderBalances, getKnownIsContract, computeTrueHolderCount,
  getDaysNeedingSupplyBackfill, getHoursNeedingSupplyBackfill,
  upsertInfluenceTransfers, getLastInfluenceBlock, setLastInfluenceBlock,
  upsertVaultPayouts, getLastVaultBlock, setLastVaultBlock,
  reconcileStatus,
} from '../lib/db.js';

const TX_INTERVAL_MS       = 15_000;
const SNAPSHOT_INTERVAL_MS = 60_000;
const HOLDERS_INTERVAL_MS  = 15 * 60_000;

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
            const rows = logs.map(t => ({
              ...t,
              rawValue: t.amount.toString(),
              ...classifyTransfer(t.fromAddr, t.toAddr, t.amount),
            }));
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
    const [dirtySupply, infSupply, ethPrice] = await Promise.allSettled([
      fetchSupply(DIRTY),
      fetchSupply(INFLUENCE),
      fetchEthPrice(),
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
            const rows = logs.map(t => ({
              ...t,
              rawValue: t.amount.toString(),
              ...classifyTransfer(t.fromAddr, t.toAddr, t.amount),
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
  await Promise.all([syncTransfers(), syncInfluence(), syncVault()]);
  await backfillSupplyHistory().catch(err => console.error('[poller] backfill error:', err.message));
  syncSnapshots();
  syncHolders();
  setInterval(syncInfluence,  TX_INTERVAL_MS);
  setInterval(syncTransfers,  TX_INTERVAL_MS);
  setInterval(syncVault,      TX_INTERVAL_MS);
  setInterval(syncSnapshots,  SNAPSHOT_INTERVAL_MS);
  setInterval(syncHolders,    HOLDERS_INTERVAL_MS);
  setInterval(() => backfillSupplyHistory().catch(() => {}), 60 * 60_000);
}
