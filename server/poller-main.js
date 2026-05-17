// Standalone entry point for the poller process.
// Run: node --env-file=.env server/poller-main.js
// Deploy separately on Fly.io / Railway / any always-on host.
import { getDb } from '../lib/index.js';
import { startPoller } from './poller.js';
// Also accumulate ETH candles in this process so the eth_candles table keeps
// ticking while the Next.js process is restarting. The Next.js cache reloads
// from the same table on boot, so any downtime gap stays filled.
import { getEthCandles } from '../lib/eth-candles.js';

// Ensure DB connection before polling
getDb();

// Triggering a read kicks ensureSingleton(): subscribes to ethPriceFeed, seeds
// from DB, starts the flush + prune timers.
getEthCandles('1m');

startPoller().catch(err => {
  console.error('[poller-main] fatal:', err.message);
  process.exit(1);
});
