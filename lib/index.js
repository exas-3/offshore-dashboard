// Single import point for all API routes.
// Uses PostgreSQL (lib/db.js) when DATABASE_URL is set, SQLite adapter otherwise.
let impl;
if (process.env.DATABASE_URL) {
  impl = await import('./db.js');
} else {
  impl = await import('./db-sqlite.js');
}
export const {
  getDb, getLastBlock, setLastBlock, getLastInfluenceBlock, setLastInfluenceBlock,
  getLastVaultBlock, setLastVaultBlock, upsertTransfers, getRecentTransfers,
  getTotalTransferCount, getStats, getOpBreakdown, getDexActivity,
  getWalletActivity, getWalletDexSummary, saveTokenInfoSnapshot, saveEthPriceSnapshot,
  getLatestTokenInfo, getLatestEthPrice, getSupplyHistory, getEthPriceHistory,
  getDaysNeedingSupplyBackfill, getHoursNeedingSupplyBackfill,
  computeHolderBalances, computeTrueHolderCount, upsertHolders, getKnownIsContract,
  getWhales, getHolderCount, getTopEarners,
  upsertInfluenceTransfers, saveInfluenceSupply, getLatestInfluenceSupply, getInfluenceStats,
  upsertVaultPayouts, getVaultStats, getVaultCycleHistory, getVaultTopEarners, getVaultRecentPayouts,
  getPlayerLeaderboard, getPlayerCount, getPlayerStats, getPlayerActivity, getPlayerVaultPayouts,
  getPlayerOpsBreakdown, getPlayerInfluenceStats, getPlayerDailyHistory,
  computeEmissions, reconcileStatus,
} = impl;
