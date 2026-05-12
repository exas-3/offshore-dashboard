// SQLite adapter — wraps server/db.js synchronous functions as async.
// Used locally when DATABASE_URL is not set.
import * as sqlite from '../server/db.js';

// ─── meta ─────────────────────────────────────────────────────────────────────
export const getLastBlock           = () => Promise.resolve(sqlite.getLastBlock());
export const setLastBlock           = n  => Promise.resolve(sqlite.setLastBlock(n));
export const getLastInfluenceBlock  = () => Promise.resolve(sqlite.getLastInfluenceBlock());
export const setLastInfluenceBlock  = n  => Promise.resolve(sqlite.setLastInfluenceBlock(n));
export const getLastVaultBlock      = () => Promise.resolve(sqlite.getLastVaultBlock());
export const setLastVaultBlock      = n  => Promise.resolve(sqlite.setLastVaultBlock(n));

// ─── transfers ────────────────────────────────────────────────────────────────
export const upsertTransfers      = rows => Promise.resolve(sqlite.upsertTransfers(rows));
export const getRecentTransfers   = (l, o) => Promise.resolve(sqlite.getRecentTransfers(l, o));
export const getTotalTransferCount= () => Promise.resolve(sqlite.getTotalTransferCount());
export const getStats             = () => Promise.resolve(sqlite.getStats());
export const getOpBreakdown       = () => Promise.resolve(sqlite.getOpBreakdown());
export const getDexActivity       = (s, l) => Promise.resolve(sqlite.getDexActivity(s, l));
export const getWalletActivity    = (a, l, s) => Promise.resolve(sqlite.getWalletActivity(a, l, s));
export const getWalletDexSummary  = a => Promise.resolve(sqlite.getWalletDexSummary(a));

// ─── token info ───────────────────────────────────────────────────────────────
export const saveTokenInfoSnapshot  = (s, h, t) => Promise.resolve(sqlite.saveTokenInfoSnapshot(s, h, t));
export const saveEthPriceSnapshot   = p  => Promise.resolve(sqlite.saveEthPriceSnapshot(p));
export const getLatestTokenInfo     = () => Promise.resolve(sqlite.getLatestTokenInfo());
export const getLatestEthPrice      = () => Promise.resolve(sqlite.getLatestEthPrice());
export const getSupplyHistory       = h  => Promise.resolve(sqlite.getSupplyHistory(h));
export const getEthPriceHistory     = h  => Promise.resolve(sqlite.getEthPriceHistory(h));
export const getDaysNeedingSupplyBackfill  = () => Promise.resolve(sqlite.getDaysNeedingSupplyBackfill());
export const getHoursNeedingSupplyBackfill = () => Promise.resolve(sqlite.getHoursNeedingSupplyBackfill());

// ─── holders ──────────────────────────────────────────────────────────────────
export const computeHolderBalances = l  => Promise.resolve(sqlite.computeHolderBalances(l));
export const computeTrueHolderCount= () => Promise.resolve(sqlite.computeTrueHolderCount());
export const upsertHolders         = h  => Promise.resolve(sqlite.upsertHolders(h));
export const getKnownIsContract    = () => Promise.resolve(sqlite.getKnownIsContract());
export const getWhales             = (l, ex) => Promise.resolve(sqlite.getWhales(l, ex));
export const getHolderCount        = () => Promise.resolve(sqlite.getHolderCount());

// ─── top earners ──────────────────────────────────────────────────────────────
export const getTopEarners = l => Promise.resolve(sqlite.getTopEarners(l));

// ─── influence ────────────────────────────────────────────────────────────────
export const upsertInfluenceTransfers  = rows => Promise.resolve(sqlite.upsertInfluenceTransfers(rows));
export const saveInfluenceSupply       = s    => Promise.resolve(sqlite.saveInfluenceSupply(s));
export const getLatestInfluenceSupply  = ()   => Promise.resolve(sqlite.getLatestInfluenceSupply());
export const getInfluenceStats         = ()   => Promise.resolve(sqlite.getInfluenceStats());

// ─── vault ────────────────────────────────────────────────────────────────────
export const upsertVaultPayouts    = rows => Promise.resolve(sqlite.upsertVaultPayouts(rows));
export const getVaultStats         = ()   => Promise.resolve(sqlite.getVaultStats());
export const getVaultCycleHistory  = l    => Promise.resolve(sqlite.getVaultCycleHistory(l));
export const getVaultTopEarners    = l    => Promise.resolve(sqlite.getVaultTopEarners(l));
export const getVaultRecentPayouts = l    => Promise.resolve(sqlite.getVaultRecentPayouts(l));

// ─── players ──────────────────────────────────────────────────────────────────
export const getPlayerLeaderboard  = (l, o) => Promise.resolve(sqlite.getPlayerLeaderboard(l, o));
export const getPlayerCount        = ()      => Promise.resolve(sqlite.getPlayerCount());
export const getPlayerStats        = a       => Promise.resolve(sqlite.getPlayerStats(a));
export const getPlayerActivity     = (a,l,o) => Promise.resolve(sqlite.getPlayerActivity(a, l, o));
export const getPlayerVaultPayouts = (a, l)  => Promise.resolve(sqlite.getPlayerVaultPayouts(a, l));
export const getPlayerOpsBreakdown = a       => Promise.resolve(sqlite.getPlayerOpsBreakdown(a));
export const getPlayerInfluenceStats = a     => Promise.resolve(sqlite.getPlayerInfluenceStats(a));
export const getPlayerDailyHistory = a       => Promise.resolve(sqlite.getPlayerDailyHistory(a));

// ─── chart buckets ────────────────────────────────────────────────────────────
function bucketLabels(startTs, numSlots, unit) {
  return Array.from({ length: numSlots }, (_, i) => {
    const ts = new Date((startTs + i * unit) * 1000);
    return unit === 3600
      ? `${ts.getUTCMonth() + 1}/${ts.getUTCDate()} ${String(ts.getUTCHours()).padStart(2, '0')}h`
      : `${ts.getUTCMonth() + 1}/${ts.getUTCDate()}`;
  });
}

export async function getSupplyHistoryForChart(unit) {
  const daily  = sqlite.getDailySupplyHistory();
  const hourly = sqlite.getHourlySupplyHistory();
  return Promise.resolve(unit === 86400 ? daily : hourly);
}

export async function computeEmissions() {
  const [
    dailyBuckets,      hourlyBuckets,
    dailyBurnBuckets,  hourlyBurnBuckets,
    dailyFlowBuckets,  hourlyFlowBuckets,
    dailySupply,       hourlySupply,
    dailyInfluence,    hourlyInfluence,
    influenceStats,
    dailyParticipants, hourlyParticipants,
    dailyActiveWallets,hourlyActiveWallets,
    dailyOpBreakdown,  hourlyOpBreakdown,
  ] = await Promise.all([
    Promise.resolve(sqlite.getDailyBuckets()),      Promise.resolve(sqlite.getHourlyBuckets()),
    Promise.resolve(sqlite.getDailyBurnBuckets()),  Promise.resolve(sqlite.getHourlyBurnBuckets()),
    Promise.resolve(sqlite.getDailyFlowBuckets()),  Promise.resolve(sqlite.getHourlyFlowBuckets()),
    Promise.resolve(sqlite.getDailySupplyHistory()),Promise.resolve(sqlite.getHourlySupplyHistory()),
    Promise.resolve(sqlite.getDailyInfluenceBuckets()), Promise.resolve(sqlite.getHourlyInfluenceBuckets()),
    Promise.resolve(sqlite.getInfluenceStats()),
    Promise.resolve(sqlite.getDailyNewParticipants()),  Promise.resolve(sqlite.getHourlyNewParticipants()),
    Promise.resolve(sqlite.getDailyActiveWallets()),    Promise.resolve(sqlite.getHourlyActiveWallets()),
    Promise.resolve(sqlite.getDailyOpBreakdown()),      Promise.resolve(sqlite.getHourlyOpBreakdown()),
  ]);
  return {
    dailyBuckets, hourlyBuckets,
    dailyBurnBuckets, hourlyBurnBuckets,
    dailyFlowBuckets, hourlyFlowBuckets,
    dailySupply, hourlySupply,
    dailyInfluence, hourlyInfluence,
    influenceStats,
    dailyParticipants, hourlyParticipants,
    dailyActiveWallets, hourlyActiveWallets,
    dailyOpBreakdown, hourlyOpBreakdown,
  };
}

export let reconcileStatus = { running: false, done: 0, total: 0, added: 0, error: null };
export function getDb() { return null; }
