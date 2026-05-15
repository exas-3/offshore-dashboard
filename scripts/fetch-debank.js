// Fetches DeBank display names for all wallets with app activity.
// Resumable: skips addresses already in debank_checked_at.
// Requires DEBANK_ACCESS_KEY from cloud.debank.com (free tier: 2M CU/month).
// Each address costs 10 CU → 200k lookups on free tier.
import postgres from 'postgres';

const db = postgres(process.env.DATABASE_URL);
const ACCESS_KEY = process.env.DEBANK_ACCESS_KEY;
const BASE = 'https://pro-openapi.debank.com/v1';
const DELAY_MS = 200; // 5 req/s, well within free tier limits

if (!ACCESS_KEY) {
  console.error('DEBANK_ACCESS_KEY not set — sign up at cloud.debank.com for a free key');
  process.exit(1);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchUser(address) {
  const res = await fetch(`${BASE}/user/addr?id=${address}`, {
    headers: { 'AccessKey': ACCESS_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // name is the user's display name (Twitter handle, custom name, etc.)
  return data?.name || null;
}

async function main() {
  const wallets = await db`
    SELECT DISTINCT addr FROM (
      SELECT from_addr AS addr FROM transfers
      UNION SELECT to_addr              FROM transfers
      UNION SELECT recipient            FROM vault_payouts
      UNION SELECT user_addr            FROM staking_deposits
      UNION SELECT from_addr            FROM influence_transfers
      UNION SELECT to_addr              FROM influence_transfers
    ) t
    WHERE addr != '0x0000000000000000000000000000000000000000'
      AND addr IS NOT NULL
  `;

  const done = await db`SELECT address FROM wallet_aliases WHERE debank_checked_at IS NOT NULL`;
  const doneSet = new Set(done.map(r => r.address));

  const todo = wallets.map(r => r.addr).filter(a => !doneSet.has(a));
  console.log(`${wallets.length} total wallets, ${doneSet.size} already checked, ${todo.length} remaining`);
  console.log(`Estimated CU cost: ${todo.length * 10} / 2,000,000 free monthly`);

  let found = 0, empty = 0, errors = 0;

  for (let i = 0; i < todo.length; i++) {
    const address = todo[i];
    try {
      const name = await fetchUser(address);
      const now = Math.floor(Date.now() / 1000);
      await db`
        INSERT INTO wallet_aliases (address, debank_alias, debank_checked_at, checked_at)
        VALUES (${address}, ${name}, ${now}, ${now})
        ON CONFLICT (address) DO UPDATE
          SET debank_alias = EXCLUDED.debank_alias, debank_checked_at = EXCLUDED.debank_checked_at
      `;
      if (name) { found++; process.stdout.write(`[${i+1}/${todo.length}] ${address} → ${name}\n`); }
      else       { empty++; }
    } catch (err) {
      errors++;
      process.stdout.write(`[${i+1}/${todo.length}] ERROR ${address}: ${err.message}\n`);
    }

    if ((i + 1) % 100 === 0) {
      console.log(`--- progress: ${i+1}/${todo.length} | found=${found} empty=${empty} errors=${errors}`);
    }

    if (i < todo.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. found=${found} empty=${empty} errors=${errors}`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
