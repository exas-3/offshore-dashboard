// Fetches Arkham Intelligence labels for all wallets.
// Resumable: skips addresses already in arkham_checked_at.
// Requires ARKHAM_API_KEY in environment.
// Uses batch endpoint (POST /intelligence/address/batch/all) — up to 20 per request.
import postgres from 'postgres';

const db = postgres(process.env.DATABASE_URL);
const API_KEY = process.env.ARKHAM_API_KEY;
const BASE = 'https://api.arkm.com';
const BATCH_SIZE = 20;
const DELAY_MS = 500;

if (!API_KEY) {
  console.error('ARKHAM_API_KEY not set in environment');
  process.exit(1);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function extractLabel(data) {
  if (!data) return null;
  // Priority: arkhamLabel > arkhamEntity > predictedEntity
  const label = data.arkhamLabel?.name
    || data.arkhamEntity?.name
    || data.predictedEntity?.entity?.name
    || null;
  return label || null;
}

async function fetchBatch(addresses) {
  const res = await fetch(`${BASE}/intelligence/address/batch/all`, {
    method: 'POST',
    headers: {
      'API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ addresses }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`);
  }
  return res.json();
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

  const done = await db`SELECT address FROM wallet_aliases WHERE arkham_checked_at IS NOT NULL`;
  const doneSet = new Set(done.map(r => r.address));

  const todo = wallets.map(r => r.addr).filter(a => !doneSet.has(a));
  console.log(`${wallets.length} total wallets, ${doneSet.size} already checked, ${todo.length} remaining`);

  let found = 0, empty = 0, errors = 0;
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    try {
      const result = await fetchBatch(batch);
      for (const address of batch) {
        const data = result[address];
        const label = extractLabel(data);
        await db`
          INSERT INTO wallet_aliases (address, arkham_alias, arkham_checked_at, checked_at)
          VALUES (${address}, ${label}, ${now}, ${now})
          ON CONFLICT (address) DO UPDATE SET arkham_alias = EXCLUDED.arkham_alias, arkham_checked_at = EXCLUDED.arkham_checked_at
        `;
        if (label) { found++; process.stdout.write(`  ${address} → ${label}\n`); }
        else       { empty++; }
      }
    } catch (err) {
      errors++;
      process.stdout.write(`[batch ${i}-${i+BATCH_SIZE}] ERROR: ${err.message}\n`);
    }

    const done_count = Math.min(i + BATCH_SIZE, todo.length);
    if (done_count % 100 === 0 || done_count === todo.length) {
      console.log(`--- progress: ${done_count}/${todo.length} | found=${found} empty=${empty} errors=${errors}`);
    }

    if (i + BATCH_SIZE < todo.length) await sleep(DELAY_MS);
  }

  console.log(`\nDone. found=${found} empty=${empty} errors=${errors}`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
