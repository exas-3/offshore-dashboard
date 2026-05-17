/**
 * One-time migration: reclassify existing TRANSFER and MINT rows.
 *
 * 1. TRANSFER rows whose from/to is a DEX pool → op_type = DEX_SELL / DEX_BUY
 * 2. MINT PARTIAL rows whose parent tx called scrapInventoryItem → op_type = SCRAP_ITEM
 *
 * Run once after deploying the updated poller:
 *   node --env-file=.env scripts/migrate-dex-classification.js
 */

import postgres from 'postgres';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const db = postgres(DB_URL, {
  max: 3,
  ssl: DB_URL.includes('localhost') || DB_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
});

const RPC = 'https://mainnet.megaeth.com/rpc';

const DEX_POOLS = [
  '0xf9f676066eb7baeeed93e859bc26a41663f277a8',
  '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1',
];

const SCRAP_SEL = '0x046d03d1';

async function rpcBatch(reqs) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqs.map((r, i) => ({ jsonrpc: '2.0', ...r, id: i }))),
  });
  return res.json();
}

// ─── phase 1: DEX reclassification ───────────────────────────────────────────

async function migrateDex() {
  const sells = await db`
    UPDATE transfers SET op_type = 'DEX_SELL'
    WHERE kind = 'TRANSFER' AND op_type NOT IN ('DEX_SELL','DEX_BUY')
      AND to_addr = ANY(${DEX_POOLS})
    RETURNING hash`;

  const buys = await db`
    UPDATE transfers SET op_type = 'DEX_BUY'
    WHERE kind = 'TRANSFER' AND op_type NOT IN ('DEX_SELL','DEX_BUY')
      AND from_addr = ANY(${DEX_POOLS})
    RETURNING hash`;

  console.log(`[DEX] Updated ${sells.length} DEX_SELL rows`);
  console.log(`[DEX] Updated ${buys.length} DEX_BUY rows`);
}

// ─── phase 2: scrapInventoryItem reclassification ────────────────────────────

async function migrateScrapItem() {
  // Fetch MINT rows that are currently PARTIAL (non-round amounts that aren't missions).
  // These could be scrapInventoryItem calls.
  const rows = await db`
    SELECT DISTINCT hash FROM transfers
    WHERE kind = 'MINT' AND op_type = 'PARTIAL'
    ORDER BY hash`;

  if (!rows.length) { console.log('[SCRAP] No PARTIAL mints to check'); return; }
  console.log(`[SCRAP] Checking ${rows.length} PARTIAL mint transactions...`);

  const hashes = rows.map(r => r.hash);
  const CHUNK  = 100;
  let updated  = 0;

  for (let i = 0; i < hashes.length; i += CHUNK) {
    const chunk = hashes.slice(i, i + CHUNK);
    const reqs  = chunk.map((h, j) => ({ method: 'eth_getTransactionByHash', params: [h], id: j }));
    const results = await rpcBatch(reqs);

    const scrapHashes = [];
    for (const r of results) {
      const tx = r.result;
      if (tx?.input?.slice(0, 10).toLowerCase() === SCRAP_SEL) {
        scrapHashes.push(chunk[r.id]);
      }
    }

    if (scrapHashes.length) {
      await db`
        UPDATE transfers SET op_type = 'SCRAP_ITEM'
        WHERE kind = 'MINT' AND op_type = 'PARTIAL' AND hash = ANY(${scrapHashes})`;
      updated += scrapHashes.length;
    }

    const pct = Math.round(((i + chunk.length) / hashes.length) * 100);
    console.log(`[SCRAP] ${i + chunk.length}/${hashes.length} (${pct}%) — ${updated} scrap txs found so far`);

    if (i + CHUNK < hashes.length) await new Promise(r => setTimeout(r, 400));
  }

  console.log(`[SCRAP] Done — updated ${updated} rows to SCRAP_ITEM`);
}

async function run() {
  try {
    await migrateDex();
    await migrateScrapItem();
  } finally {
    await db.end();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
