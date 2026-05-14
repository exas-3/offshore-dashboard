// Dashboard data — async fetch from the Next.js API.
// Falls back to a zeroed-out static shape if the API is unreachable.

(function () {
  const API = 'http://localhost:3000';

  const FALLBACK = {
    hero: {
      dirtyPrice: 0, opCost: 12.41, supply: 0,
      supplyTotalCirculating: '0', burnedRatio: 0, burnedAllTime: '0',
      totalOps: 0, totalOpsLabel: '0', dirtyEmitted: '0',
      tokenHolders: 0, uniqueWallets: 0,
    },
    supplyOverTime:  [],
    emissionsVsBurn: [],
    influenceFlow: {
      totals: { purchased: 0, consumed: 0, refunded: 0, circulating: 0 },
      days: [],
    },
    burnedDaily: [],
    newParticipants: [], newParticipantsTotal: 0,
    dailyActiveWallets: [], dailyActiveWalletsPeak: 0,
    usdmPerCycle: [], recipientsPerCycle: [], newRecipientsPerCycle: [],
    distributionTotals: { total: 0, totalLabel: '0', cyclesPaid: 0, uniqueRecipients: 0 },
    companies: {
      totalCompanies: 0, uniqueOwners: 0,
      activeTrades: 0, autoTradeOn: 0, autoTradeShareLabel: '0% of all',
    },
    liveTrades: [],
    onChainStrip: { influence: 0, dirtyBal: '0', opCost: '— INF', companies: 0, activeCompanies: 0, autoCompanies: 0, status: 'loading' },
    wallet: {
      address: '—',
      indexed: {
        totalOps: 0, dirtyEarned: '0', dirtySpent: '0',
        infBought: 0, infBoughtPurchases: 0, infRefunded: 0,
        dexSold: '0', dexSoldTxs: 0, dexBought: '0', dexBoughtTxs: 0,
        vaultClaimed: '$0', vaultPayouts: 0, balance: '0',
      },
      earnedByOp: [], spent: [], farmedDaily: [],
    },
    heatmap: Array.from({ length: 7 }, () => Array(24).fill(0)),
    heatmapDays: ['', '', '', '', '', '', ''],
    liveTradeTicker: [],
    apps: [
      { id: 'offshore',    name: 'Offshore',      tag: 'GAME',    active: true,  glyph: 'OF' },
      { id: 'euphoria',    name: 'Euphoria',       tag: 'PERP',    active: false, glyph: 'EU' },
      { id: 'topstrike',   name: 'TopStrike',      tag: 'PREDICT', active: false, glyph: 'TS' },
      { id: 'blackhaven',  name: 'BlackHaven',     tag: 'LEND',    active: false, glyph: 'BH' },
      { id: 'sirtrading',  name: 'SirTrading',     tag: 'AGENT',   active: false, glyph: 'ST' },
      { id: 'mnstr',       name: 'mnstr.xyz',      tag: 'GAME',    active: false, glyph: 'MN' },
      { id: 'ubitel',      name: 'Ubitel',         tag: 'SOCIAL',  active: false, glyph: 'UB' },
      { id: 'aave',        name: 'Aave',           tag: 'LEND',    active: false, glyph: 'AV' },
      { id: 'worldmarket', name: 'WorldMarket',    tag: 'TRADE',   active: false, glyph: 'WM' },
      { id: 'mega',        name: 'Mega · Wallets', tag: 'INDEX',   active: false, glyph: 'M*', isMeta: true },
    ],
    recentOps: [],
    counterInit: { block: 0, daw: 0, opsMin: 0, dirty: 0, opCost: 12.41, gas: 0.001 },
  };

  window.__dataReady = fetch(`${API}/api/offshore-data`, { cache: 'no-cache' })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(d => {
      window.OFFSHORE_DATA = d;
    })
    .catch(err => {
      console.warn('[data] API unreachable, using fallback:', err.message);
      window.OFFSHORE_DATA = FALLBACK;
    });
})();
