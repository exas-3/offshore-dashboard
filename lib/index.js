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
  upsertVaultPayouts, getVaultStats, getVaultCycleHistory, getVaultTopEarners, getVaultRecentPayouts, getVaultFirstPayouts,
  getPlayerLeaderboard, getPlayerCount, getPlayerStats, getPlayerActivity, getPlayerVaultPayouts,
  getPlayerOpsBreakdown, getPlayerInfluenceStats, getPlayerDailyHistory, getPlayerRecentMissionStats,
  computeEmissions, reconcileStatus, getEconomyBuckets,
  getKnownWallets, upsertCompanies, getCompanyStats, getCompanies,
  getAllPlayerAddresses, getEnhancedLeaderboard,
  getMissionStats,
  getDistinctMintHashes, getDistinctSpendHashes, batchUpdateMintOpTypes,
  getLastLiqBlock, setLastLiqBlock, syncLiquidationsFromIdx,
} = impl;

// idx-queries run against idx_logs (PostgreSQL only — no SQLite stubs needed).
let idxImpl;
if (process.env.DATABASE_URL) {
  idxImpl = await import('./idx-queries.js');
} else {
  const empty = async () => [];
  idxImpl = {
    getDexPriceHistory: empty, getDexRecentSwaps: empty,
    getV3RecentSwaps: empty,
    getIdxVaultCycles: empty,
    getIdxPlayerTrades: empty, getIdxPlayerTradeStats: async () => null,
    getIdxPlayerCompanies: empty,
    getIdxFactoryStats: async () => ({ totalCompanies: 0, levelUps: 0, companiesSold: 0 }),
    getCompanyCreationHistory: empty,
    getDirtyFarmers: empty,
    getDirtyMarketCapHistory: empty,
    decodeInt256Wei: (h) => 0,
  };
}
export const {
  getDexPriceHistory, getDexRecentSwaps,
  getV3RecentSwaps,
  getIdxVaultCycles,
  getIdxPlayerTrades, getIdxPlayerTradeStats,
  getIdxPlayerCompanies,
  getIdxFactoryStats, getCompanyCreationHistory,
  getDirtyFarmers,
  getDirtyMarketCapHistory,
  decodeInt256Wei,
} = idxImpl;
