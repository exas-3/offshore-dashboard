// Fetches .mega primary names for all wallets with app activity.
// Resumable: skips addresses already in wallet_aliases.
// Rate limit: 60 req/min → 1 req/s with a small buffer.
import postgres from 'postgres';

const db = postgres(process.env.DATABASE_URL);
const BASE = 'https://api.dotmega.domains';
const DELAY_MS = 1050; // ~57 req/min, safely under 60

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function resolveName(address) {
  const res = await fetch(`${BASE}/resolve?address=${address}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.name || null;
}

async function main() {
  // All unique wallets across all activity tables
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

  // Already checked
  const done = await db`SELECT address FROM wallet_aliases`;
  const doneSet = new Set(done.map(r => r.address));

  const todo = wallets.map(r => r.addr).filter(a => !doneSet.has(a));
  console.log(`${wallets.length} total wallets, ${doneSet.size} already checked, ${todo.length} remaining`);

  let found = 0, empty = 0, errors = 0;

  for (let i = 0; i < todo.length; i++) {
    const address = todo[i];
    try {
      const name = await resolveName(address);
      await db`
        INSERT INTO wallet_aliases (address, alias, checked_at)
        VALUES (${address}, ${name}, ${Math.floor(Date.now() / 1000)})
        ON CONFLICT (address) DO UPDATE SET alias = EXCLUDED.alias, checked_at = EXCLUDED.checked_at
      `;
      if (name) { found++; process.stdout.write(`[${i+1}/${todo.length}] ${address} → ${name}\n`); }
      else       { empty++; }
    } catch (err) {
      errors++;
      process.stdout.write(`[${i+1}/${todo.length}] ERROR ${address}: ${err.message}\n`);
    }

    if ((i + 1) % 50 === 0) {
      console.log(`--- progress: ${i+1}/${todo.length} | found=${found} empty=${empty} errors=${errors}`);
    }

    if (i < todo.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. found=${found} empty=${empty} errors=${errors}`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
