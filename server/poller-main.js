// Standalone entry point for the poller process.
// Run: node --env-file=.env server/poller-main.js
// Deploy separately on Fly.io / Railway / any always-on host.
import { getDb } from '../lib/db.js';
import { startPoller } from './poller.js';

// Ensure DB connection before polling
getDb();

startPoller().catch(err => {
  console.error('[poller-main] fatal:', err.message);
  process.exit(1);
});
