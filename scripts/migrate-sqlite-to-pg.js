#!/usr/bin/env node
// Migrate data from SQLite (offshore.db) to PostgreSQL (Supabase).
// Usage: node --env-file=.env scripts/migrate-sqlite-to-pg.js [path/to/offshore.db]
//
// Requires both DATABASE_URL (Supabase) and access to the SQLite file.

import Database from 'better-sqlite3';
import postgres from 'postgres';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = process.argv[2] ?? join(__dirname, '..', 'offshore.db');
const BATCH     = 500;

const sqlite = new Database(DB_PATH, { readonly: true });
const sql    = postgres(process.env.DATABASE_URL, {
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: 5,
});

async function migrate(table, selectSql, mapFn, pgFn) {
  const rows = sqlite.prepare(selectSql).all();
  console.log(`[migrate] ${table}: ${rows.length} rows`);
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map(mapFn);
    await pgFn(chunk);
    process.stdout.write(`\r[migrate] ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log();
}

async function main() {
  console.log(`[migrate] Reading from: ${DB_PATH}`);
  console.log(`[migrate] Writing to: ${process.env.DATABASE_URL?.replace(/:([^:@]+)@/, ':***@')}`);

  // transfers
  await migrate('transfers',
    'SELECT * FROM transfers',
    r => ({ hash: r.hash, log_index: r.log_index, block_num: r.block_num, timestamp: r.timestamp,
            from_addr: r.from_addr, to_addr: r.to_addr, raw_value: r.raw_value,
            amount: r.amount, kind: r.kind, op_type: r.op_type }),
    chunk => sql`INSERT INTO transfers ${sql(chunk)} ON CONFLICT DO NOTHING`
  );

  // influence_transfers
  await migrate('influence_transfers',
    'SELECT * FROM influence_transfers',
    r => ({ hash: r.hash, log_index: r.log_index, block_num: r.block_num, timestamp: r.timestamp,
            from_addr: r.from_addr, to_addr: r.to_addr, amount: r.amount, kind: r.kind }),
    chunk => sql`INSERT INTO influence_transfers ${sql(chunk)} ON CONFLICT DO NOTHING`
  );

  // vault_payouts
  await migrate('vault_payouts',
    'SELECT * FROM vault_payouts',
    r => ({ hash: r.hash, log_index: r.log_index, block_num: r.block_num, timestamp: r.timestamp,
            recipient: r.recipient, amount: r.amount }),
    chunk => sql`INSERT INTO vault_payouts ${sql(chunk)} ON CONFLICT DO NOTHING`
  );

  // supply_snapshots
  await migrate('supply_snapshots',
    'SELECT timestamp, supply, holders FROM supply_snapshots ORDER BY id ASC',
    r => ({ timestamp: r.timestamp, supply: r.supply, holders: r.holders }),
    chunk => sql`INSERT INTO supply_snapshots ${sql(chunk)}`
  );

  // eth_price_snapshots
  await migrate('eth_price_snapshots',
    'SELECT timestamp, price_usd FROM eth_price_snapshots ORDER BY id ASC',
    r => ({ timestamp: r.timestamp, price_usd: r.price_usd }),
    chunk => sql`INSERT INTO eth_price_snapshots ${sql(chunk)}`
  );

  // influence_supply_snapshots
  await migrate('influence_supply_snapshots',
    'SELECT timestamp, supply FROM influence_supply_snapshots ORDER BY id ASC',
    r => ({ timestamp: r.timestamp, supply: r.supply }),
    chunk => sql`INSERT INTO influence_supply_snapshots ${sql(chunk)}`
  );

  // token_holders
  await migrate('token_holders',
    'SELECT * FROM token_holders',
    r => ({ address: r.address, balance: r.balance, balance_raw: r.balance_raw,
            rank: r.rank, is_contract: !!r.is_contract, last_snapshot: r.last_snapshot }),
    chunk => sql`INSERT INTO token_holders ${sql(chunk)} ON CONFLICT(address) DO UPDATE SET
      balance=EXCLUDED.balance, balance_raw=EXCLUDED.balance_raw,
      rank=EXCLUDED.rank, is_contract=EXCLUDED.is_contract, last_snapshot=EXCLUDED.last_snapshot`
  );

  // meta
  const meta = sqlite.prepare('SELECT key, value FROM meta').all();
  for (const { key, value } of meta) {
    await sql`INSERT INTO meta(key,value) VALUES(${key},${value}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
  }
  console.log(`[migrate] meta: ${meta.length} rows`);

  console.log('[migrate] Complete!');
  await sql.end();
  sqlite.close();
}

main().catch(err => { console.error('[migrate] Error:', err.message); process.exit(1); });
