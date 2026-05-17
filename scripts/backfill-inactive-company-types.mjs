// Backfill companies.trade_type for INACTIVE companies. The poller only types
// active rows. For inactive companies, storage slots 4 (last trade start) and
// 5 (last trade end) still reflect the most recent trade — duration =
// slot5 - slot4 gives the LAST trade's type.
//
// Useful for historical analytics. Live "ongoing crimes" already works.
//
// Run on each DB:
//   node --env-file=.env scripts/backfill-inactive-company-types.mjs

import { getDb } from '../lib/db/connection.js';
import { getCompanyTradeTypesFromStorage } from '../server/etherscan.js';

const db = getDb();

async function run() {
  const rows = await db`
    SELECT address FROM companies WHERE trade_type IS NULL`;
  console.log(`companies without trade_type: ${rows.length}`);
  if (!rows.length) { console.log('nothing to do.'); process.exit(0); }

  const counts = { DRUG_DEAL: 0, ARMS_DEAL: 0, EXTORTION: 0, unresolved: 0 };
  const CHUNK = 200;  // 200 companies → 400 RPC reqs per outer iteration
  for (let i = 0; i < rows.length; i += CHUNK) {
    const addrs = rows.slice(i, i + CHUNK).map(r => r.address);
    const typeMap = await getCompanyTradeTypesFromStorage(addrs).catch(() => new Map());

    // Group by new trade_type and issue one UPDATE per group.
    const byType = { DRUG_DEAL: [], ARMS_DEAL: [], EXTORTION: [] };
    for (const a of addrs) {
      const t = typeMap.get(a.toLowerCase());
      if (t && byType[t]) { byType[t].push(a); counts[t]++; }
      else counts.unresolved++;
    }
    for (const t of Object.keys(byType)) {
      if (!byType[t].length) continue;
      await db`UPDATE companies SET trade_type = ${t} WHERE address = ANY(${byType[t]}) AND trade_type IS NULL`;
    }
    if ((i / CHUNK) % 5 === 0) {
      process.stdout.write(`  …${i + addrs.length}/${rows.length}\n`);
    }
  }

  console.log(`\ndone:`);
  console.log(`  DRUG_DEAL:  ${counts.DRUG_DEAL}`);
  console.log(`  ARMS_DEAL:  ${counts.ARMS_DEAL}`);
  console.log(`  EXTORTION:  ${counts.EXTORTION}`);
  console.log(`  unresolved: ${counts.unresolved}`);

  const summary = await db`
    SELECT trade_type, active, COUNT(*)::int AS cnt
    FROM companies GROUP BY trade_type, active ORDER BY active DESC, cnt DESC`;
  console.log(`\nfinal distribution:`);
  summary.forEach(r => console.log(`  active=${r.active}  trade_type=${String(r.trade_type).padEnd(10)}  ${r.cnt}`));
  process.exit(0);
}
run().catch(err => { console.error(err); process.exit(1); });
