// Backfill eth_price_snapshots with the REAL historical RedStone oracle tape.
//
// The poller's eth_price_snapshots table only ever retained ~25h (cleanup in
// lib/db/token.js), so the recorded window has no ETH history. MegaETH's
// public RPC serves archive state, and timestamp = block + GENESIS exactly,
// so we can eth_call latestRoundData() on the same Chainlink-compatible
// adapter the dashboard always used (0xc555…7f09) at any historical block
// and recover the exact per-minute oracle answers.
//
// Usage: node --env-file=.env scripts/backfill-eth-oracle.mjs <fromTs> <toTs> [stepSec]
//   e.g. node --env-file=.env scripts/backfill-eth-oracle.mjs 1777991880 1780208280 60
//
// Idempotent: skips minutes that already have a snapshot row.

import { getDb } from '../lib/db/connection.js';

const RPC     = 'https://mainnet.megaeth.com/rpc';
const ORACLE  = '0xc555c100DB24dF36D406243642C169CC5A937f09';
const GENESIS = 1_762_797_011;
const CONCURRENCY = 16;

const fromTs = Number(process.argv[2]);
const toTs   = Number(process.argv[3]);
const step   = Number(process.argv[4]) || 60;
if (!fromTs || !toTs || toTs <= fromTs) {
  console.error('usage: backfill-eth-oracle.mjs <fromTs> <toTs> [stepSec]');
  process.exit(1);
}

const db = getDb();

async function readOracleAt(blockNum, attempt = 0) {
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: ORACLE, data: '0xfeaf968c' }, '0x' + blockNum.toString(16)],
      }),
    });
    const { result, error } = await res.json();
    if (error || !result || result.length < 130) throw new Error(error?.message || 'empty result');
    const answer = Number(BigInt('0x' + result.slice(66, 130))) / 1e8;
    if (!isFinite(answer) || answer <= 0) throw new Error('bad answer');
    return answer;
  } catch (err) {
    if (attempt < 5) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      return readOracleAt(blockNum, attempt + 1);
    }
    console.error(`[skip] block ${blockNum}: ${err.message}`);
    return null;
  }
}

// Minutes already covered (any row in the same 60s bucket).
const existing = new Set(
  (await db`
    SELECT DISTINCT (timestamp / 60 * 60)::bigint AS m
    FROM eth_price_snapshots
    WHERE timestamp >= ${fromTs} AND timestamp <= ${toTs}`
  ).map(r => Number(r.m))
);

const targets = [];
for (let ts = Math.ceil(fromTs / step) * step; ts <= toTs; ts += step) {
  if (!existing.has(Math.floor(ts / 60) * 60)) targets.push(ts);
}
console.log(`sampling ${targets.length} points (${existing.size} minutes already present) …`);

let done = 0, inserted = 0, buf = [];
async function flush() {
  if (!buf.length) return;
  const rows = buf; buf = [];
  await db`INSERT INTO eth_price_snapshots ${db(rows)}`;
  inserted += rows.length;
}

async function worker(queue) {
  for (;;) {
    const ts = queue.pop();
    if (ts == null) return;
    const price = await readOracleAt(ts - GENESIS);
    if (price != null) buf.push({ timestamp: ts, price_usd: price });
    if (buf.length >= 200) await flush();
    if (++done % 2000 === 0) console.log(`  ${done}/${targets.length} (last $${price?.toFixed(2) ?? '—'})`);
  }
}

const queue = [...targets].reverse();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
await flush();
console.log(`done: ${inserted} rows inserted`);
process.exit(0);
