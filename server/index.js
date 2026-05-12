import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { fetchVaultBalance } from './etherscan.js';
import {
  getRecentTransfers, getStats, getDailyBuckets, getHourlyBuckets,
  getWalletActivity, getDexActivity, getWalletDexSummary,
  getDailyBurnBuckets, getHourlyBurnBuckets,
  getDailyFlowBuckets, getHourlyFlowBuckets,
  getDailySupplyHistory, getHourlySupplyHistory,
  getDailyInfluenceBuckets, getHourlyInfluenceBuckets, getInfluenceStats,
  getDailyNewParticipants, getHourlyNewParticipants,
  getDailyActiveWallets, getHourlyActiveWallets,
  getDailyOpBreakdown, getHourlyOpBreakdown,
  getTopEarners, getOpBreakdown,
  getLatestTokenInfo, getLatestEthPrice,
  getSupplyHistory, getEthPriceHistory,
  getTotalTransferCount, getWhales, computeTrueHolderCount,
  getVaultStats, getVaultCycleHistory, getVaultTopEarners, getVaultRecentPayouts,
  getPlayerLeaderboard, getPlayerStats, getPlayerActivity, getPlayerVaultPayouts, getPlayerCount,
  getPlayerOpsBreakdown, getPlayerDailyHistory, getPlayerInfluenceStats,
} from './db.js';
import { Worker } from 'worker_threads';
import { startPoller, reconcileDirtyTransfers, reconcileStatus } from './poller.js';

const app  = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// Known protocol-owned addresses — excluded from whale rankings, labelled in charts
const KNOWN_CONTRACTS = {
  '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1': 'DIRTY/USDm LP (Uni V3)',
};

app.use(cors());
app.use(express.json());

// ─── simple TTL cache (15s matches poller interval) ──────────────────────────

const _cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.val;
  const val = fn();
  _cache.set(key, { val, ts: Date.now() });
  return val;
}

// ─── background emissions pre-computation (worker thread) ────────────────────
// Runs all heavy chart queries in a separate thread so the main event loop
// is never blocked, regardless of how long the queries take.

let _emissionsCache = null;
let _emissionsWorkerBusy = false;

const _workerPath = new URL('./emissions-worker.js', import.meta.url).pathname;

function buildEmissionsCache() {
  if (_emissionsWorkerBusy) return;
  _emissionsWorkerBusy = true;
  const worker = new Worker(_workerPath);
  worker.on('message', (msg) => {
    if (msg.ok) {
      _emissionsCache = msg.data;
      console.log('[emissions] cache refreshed');
    } else {
      console.error('[emissions] worker error:', msg.error);
    }
    _emissionsWorkerBusy = false;
    worker.terminate();
  });
  worker.on('error', (err) => {
    console.error('[emissions] worker crash:', err.message);
    _emissionsWorkerBusy = false;
  });
  worker.postMessage('compute');
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function normalizeTx(t) {
  return {
    hash:   t.hash,
    ts:     t.timestamp,
    from:   t.from_addr,
    to:     t.to_addr,
    amount: t.amount,
    kind:   t.kind,
    opType: t.op_type,
  };
}

const WEEKDAY_PHASE  = 5400;                     // 01:30:00 UTC → fires 01:30 / 09:30 / 17:30
const WEEKEND_ANCHOR = 9 * 3600 + 30 * 60;      // 09:30:00 UTC — weekend/weekday boundary
const WEEKDAY_DUR    = 8  * 3600;
const WEEKEND_DUR    = 24 * 3600;

// Weekend = Saturday after 09:30 UTC, all Sunday, Monday before 09:30 UTC
function isWeekendCycle(nowSec) {
  const d        = new Date(nowSec * 1000);
  const dow      = d.getUTCDay();
  const secInDay = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  if (dow === 6 && secInDay >= WEEKEND_ANCHOR) return true;  // Sat after 09:30
  if (dow === 0) return true;                                  // All Sunday
  if (dow === 1 && secInDay <  WEEKEND_ANCHOR) return true;  // Mon before 09:30
  return false;
}

function vaultCycle() {
  const now     = Date.now() / 1000;
  const weekend = isWeekendCycle(now);
  const DUR     = weekend ? WEEKEND_DUR : WEEKDAY_DUR;
  const ANCHOR  = weekend ? WEEKEND_ANCHOR : WEEKDAY_PHASE;
  const start   = Math.floor((now - ANCHOR) / DUR) * DUR + ANCHOR;
  const elapsed   = now - start;
  const remaining = DUR - elapsed;
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = Math.floor(remaining % 60);
  return {
    progress:  elapsed / DUR,
    pct:       Math.round((elapsed / DUR) * 100),
    remaining,
    timeStr:   `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`,
    isWeekend: weekend,
    duration:  DUR,
  };
}

// ─── routes ──────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/stats', (_req, res) => {
  try {
    res.json(cached('stats', 30_000, () => {
      const tokenInfo = getLatestTokenInfo();
      return {
        ...getStats(),
        supply:      tokenInfo.supply,
        holders:     tokenInfo.holders ?? computeTrueHolderCount(),
        ethPrice:    getLatestEthPrice(),
        opBreakdown: getOpBreakdown(),
        totalTxs:    getTotalTransferCount(),
        cycle:       vaultCycle(),
      };
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/transfers', (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  ?? '100', 10), 500);
    const offset = Math.max(parseInt(req.query.offset ?? '0',   10), 0);
    const rows   = getRecentTransfers(limit, offset).map(normalizeTx);
    res.json({ transfers: rows, limit, offset });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/emissions', (_req, res) => {
  if (!_emissionsCache) return res.status(503).json({ error: 'cache warming, retry in a few seconds' });
  res.json(_emissionsCache);
});

app.get('/api/earners', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 100);
    res.json(cached('earners', 120_000, () => ({ earners: getTopEarners(limit) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vault', async (_req, res) => {
  try {
    const base = cached('vault', 15_000, () => ({
      stats:         getVaultStats(),
      cycleHistory:  getVaultCycleHistory(),
      topEarners:    getVaultTopEarners(50),
      recentPayouts: getVaultRecentPayouts(100),
    }));
    // Live vault balance from RPC — changes every few seconds as players deposit
    let currentBalance = null;
    try { currentBalance = await fetchVaultBalance(); } catch { /* non-critical */ }
    res.json({ ...base, currentBalance });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/supply-history', (req, res) => {
  try {
    const hours = parseInt(req.query.hours ?? '24', 10);
    res.json({ snapshots: getSupplyHistory(hours) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/whales', (req, res) => {
  try {
    res.json(cached('whales', 120_000, () => {
      const limit    = 200;
      const excluded = Object.keys(KNOWN_CONTRACTS);
      const whales   = getWhales(limit, excluded);
      const { supply } = getLatestTokenInfo();

      whales.forEach((w, i) => { w.rank = i + 1; });

      const allHolders = getWhales(10, []);
      const topSum  = allHolders.reduce((s, w) => s + w.balance, 0);
      const others  = supply != null ? Math.max(0, supply - topSum) : null;
      const concentration = allHolders.map(w => ({
        address:  w.address,
        label:    KNOWN_CONTRACTS[w.address] ?? null,
        balance:  w.balance,
        pct:      supply ? (w.balance / supply) * 100 : 0,
        isContract: w.isContract,
      }));
      if (others != null) {
        concentration.push({ address: 'Others', label: 'Others', balance: others, pct: (others / supply) * 100, isContract: false });
      }

      const dexSummary = getWalletDexSummary(whales.map(w => w.address));
      return { whales, concentration, supply, holderCount: getHolderCount(), knownContracts: KNOWN_CONTRACTS, dexSummary };
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/dex-activity', (req, res) => {
  try {
    const since = parseInt(req.query.since ?? '0', 10);
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100);
    const LP    = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';
    const rows  = getDexActivity(since, limit).map(t => ({
      ...normalizeTx(t),
      wallet: t.from_addr === LP ? t.to_addr : t.from_addr,
      kind:   'SWAP',
      opType: t.to_addr === LP ? 'DEX_SELL' : 'DEX_BUY',
    }));
    res.json({ activity: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/whale-activity', (req, res) => {
  try {
    const addresses = (req.query.addresses ?? '')
      .split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
    const limit = Math.min(parseInt(req.query.limit ?? '200', 10), 500);
    const since = parseInt(req.query.since ?? '0', 10);
    const LP = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';
    const rows  = getWalletActivity(addresses, limit, since).map(t => {
      const base   = normalizeTx(t);
      const wallet = addresses.includes(t.from_addr) ? t.from_addr : t.to_addr;
      // Override opType for DEX swaps
      if (t.kind === 'TRANSFER') {
        base.kind   = 'SWAP';
        base.opType = t.to_addr === LP ? 'DEX_SELL' : 'DEX_BUY';
      }
      return { ...base, wallet };
    });
    res.json({ activity: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/players', (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  ?? '200', 10), 500);
    const offset = Math.max(parseInt(req.query.offset ?? '0',   10), 0);
    const rows   = getPlayerLeaderboard(limit, offset);
    const total  = getPlayerCount();
    res.json({ players: rows, total, limit, offset });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/players/:address', (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/i.test(address)) return res.status(400).json({ error: 'invalid address' });
    const stats    = getPlayerStats(address);
    const activity = getPlayerActivity(address, 200, 0);
    const vault    = getPlayerVaultPayouts(address, 50);
    const breakdown  = getPlayerOpsBreakdown(address);
    const history    = getPlayerDailyHistory(address);
    const influence  = getPlayerInfluenceStats(address);
    res.json({ address, stats, activity, vault, breakdown, history, influence });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/reconcile', (_req, res) => {
  if (reconcileStatus.running) return res.json({ ok: false, msg: 'already running', status: reconcileStatus });
  reconcileDirtyTransfers(); // fire and forget
  res.json({ ok: true, msg: 'reconciliation started' });
});

app.get('/api/admin/reconcile/status', (_req, res) => {
  res.json(reconcileStatus);
});

app.get('/api/eth-price-history', (req, res) => {
  try {
    const hours = parseInt(req.query.hours ?? '24', 10);
    res.json({ price: getLatestEthPrice(), history: getEthPriceHistory(hours) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── static frontend (production) ────────────────────────────────────────────

const distPath = join(__dirname, '..', 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(join(distPath, 'index.html')));
}

// ─── start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
  startPoller();
  // Build emissions cache in background. Delay the first build by 10s so the
  // server can respond to health checks before blocking starts. Refresh every 90s.
  setTimeout(buildEmissionsCache, 15_000);
  setInterval(buildEmissionsCache, 3 * 60_000);
});
