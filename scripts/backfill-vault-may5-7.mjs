// Backfill vault payouts for May 5–7 (blocks before first indexed payout).
// Safe to re-run: upsertVaultPayouts uses ON CONFLICT DO NOTHING.
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const f of ['.env.local', '.env']) {
  try {
    const env = readFileSync(resolve('/home/work/offshore-dashboard', f), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {}
}

const { fetchTransferLogs, USDM, VAULT } = await import('../server/etherscan.js');
const { getDb }                           = await import('../lib/index.js');
const { upsertVaultPayouts }              = await import('../lib/db.js');

const db = getDb();

// Block range: VAULT_START → block just before first indexed payout
// first indexed payout timestamp: 1778113797 → block = 1778113797 - 1762797011 = 15316786
const FROM_BLOCK = 15_194_000;
const TO_BLOCK   = 15_316_786;
const BATCH      = 20_000;

console.log(`Scanning USDM vault transfers: blocks ${FROM_BLOCK} → ${TO_BLOCK}`);

let total = 0;
for (let start = FROM_BLOCK; start <= TO_BLOCK; start += BATCH) {
  const end = Math.min(start + BATCH - 1, TO_BLOCK);
  process.stdout.write(`  ${start} → ${end} ... `);
  let logs;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      logs = await fetchTransferLogs(USDM, start, end);
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
      process.stdout.write(`[retry ${attempt + 1}] `);
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  const payouts = logs.filter(l => l.fromAddr.toLowerCase() === VAULT.toLowerCase());
  if (payouts.length > 0) {
    const rows = payouts.map(l => ({
      hash: l.hash, logIndex: l.logIndex, blockNum: l.blockNum,
      timestamp: l.timestamp, recipient: l.toAddr, amount: l.amount,
    }));
    await upsertVaultPayouts(rows);
    total += rows.length;
    console.log(`+${rows.length} payouts`);
  } else {
    console.log('none');
  }
  if (start + BATCH <= TO_BLOCK) await new Promise(r => setTimeout(r, 3000));
}

console.log(`\nDone. Total new payouts inserted: ${total}`);

const [counts] = await db`SELECT COUNT(*)::int AS claims, COUNT(DISTINCT recipient)::int AS unique_recipients FROM vault_payouts`;
console.log(`DB total: ${counts.claims} claims, ${counts.unique_recipients} unique recipients`);

process.exit(0);
