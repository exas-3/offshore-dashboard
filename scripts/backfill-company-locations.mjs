// One-shot backfill of companies.location_id from on-chain `locationId()`
// calls (selector 0xe8aadc3f). 6957 companies × 1 RPC call each → ~140
// batches of 50 in parallel. Safe to re-run — only updates rows where
// location_id IS NULL.
//
// Usage:  npm run backfill-company-locations
import postgres from 'postgres';

const RPC = process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.megaeth.com/rpc';
const SELECTOR = '0xe8aadc3f';   // locationId()
const CHUNK = 50;
const RETRIES = 4;
const BACKOFF_MS = [0, 1000, 3000, 8000];

const db = postgres(process.env.DATABASE_URL);

async function rpcBatch(reqs, attempt = 0) {
  const body = reqs.map((r, i) => ({ jsonrpc: '2.0', id: i, ...r }));
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok && attempt < RETRIES - 1) {
    await new Promise(r => setTimeout(r, BACKOFF_MS[attempt + 1]));
    return rpcBatch(reqs, attempt + 1);
  }
  if (!res.ok) throw new Error(`rpc ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchLocations(addrs) {
  const reqs = addrs.map(a => ({
    method: 'eth_call',
    params: [{ to: a, data: SELECTOR }, 'latest'],
  }));
  const j = await rpcBatch(reqs);
  const out = new Map();
  for (const r of j) {
    if (!r.result || r.result === '0x') continue;
    try {
      const n = Number(BigInt(r.result));
      out.set(addrs[r.id], n);
    } catch {}
  }
  return out;
}

async function main() {
  const todo = await db`
    SELECT address FROM companies
    WHERE location_id IS NULL
    ORDER BY address`;
  console.log(`[backfill-company-locations] ${todo.length} companies need location_id`);
  if (todo.length === 0) { await db.end(); return; }

  let resolved = 0;
  let skipped  = 0;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK).map(r => r.address);
    let map;
    try {
      map = await fetchLocations(chunk);
    } catch (e) {
      console.error(`[backfill-company-locations] chunk ${i}: ${e.message}`);
      skipped += chunk.length;
      continue;
    }
    await db.begin(async (tx) => {
      for (const [addr, locId] of map) {
        await tx`UPDATE companies SET location_id = ${locId} WHERE address = ${addr}`;
      }
    });
    resolved += map.size;
    skipped  += chunk.length - map.size;
    if ((i / CHUNK) % 5 === 0 || i + CHUNK >= todo.length) {
      console.log(`[backfill-company-locations] ${i + chunk.length}/${todo.length}  resolved=${resolved}  skipped=${skipped}`);
    }
    // small breather to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  // Distribution check
  const dist = await db`
    SELECT c.location_id, l.flag_emoji, l.short_name, COUNT(*)::int AS n
    FROM companies c
    LEFT JOIN game_locations l ON l.id = c.location_id
    WHERE c.location_id IS NOT NULL
    GROUP BY c.location_id, l.flag_emoji, l.short_name
    ORDER BY n DESC LIMIT 20`;
  console.log('\n[backfill-company-locations] top 20 by company count:');
  for (const r of dist) {
    console.log(`  ${String(r.location_id).padStart(3)}  ${r.flag_emoji ?? '  '}  ${(r.short_name ?? '?').padEnd(28)} ${r.n}`);
  }
  console.log('\n[backfill-company-locations] done.');
  await db.end();
}

main().catch(async (err) => {
  console.error(err);
  await db.end();
  process.exit(1);
});
