// Server-side OHLC candle cache for ETH/USD.
//
// Subscribes to the existing 1-second-polling ethPriceFeed and accumulates
// rolling per-bucket candle maps. The cache lives on globalThis so it
// survives Next.js HMR and is shared across API route invocations.
//
//   2s, 5s, 15s candles → last 1 hour (3600s)
//   1m candles          → last 2 hours (7200s)
//
// Each candle: { ts, open, high, low, close }.
// ts = bucket-start unix seconds.

import { ethPriceFeed } from './eth-price-feed.js';

export const BUCKETS = {
  '5s':  { sec:   5, maxAge: 1800 },  // 30 min
  '15s': { sec:  15, maxAge: 3600 },  // 1 h
  '1m':  { sec:  60, maxAge: 7200 },  // 2 h
};

const GLOBAL_KEY = '__ethCandleCache_v1';

function initCache() {
  const cache = {};
  for (const k of Object.keys(BUCKETS)) cache[k] = new Map(); // ts → candle
  return cache;
}

// Updated buckets (Map keyed by name → Set of ts) so we can flush to DB
// without re-walking the entire bucket each tick.
function recordSample(cache, ts, price, mode, dirty) {
  for (const [name, { sec, maxAge }] of Object.entries(BUCKETS)) {
    if (ts < Math.floor(Date.now() / 1000) - maxAge) continue;
    const map = cache[name];
    const bs  = Math.floor(ts / sec) * sec;
    const c   = map.get(bs);
    if (!c) {
      map.set(bs, { ts: bs, open: price, high: price, low: price, close: price });
    } else {
      c.close = price;
      if (price > c.high) c.high = price;
      if (price < c.low)  c.low  = price;
    }
    if (dirty) {
      if (!dirty[name]) dirty[name] = new Set();
      dirty[name].add(bs);
    }
  }
  if (mode === 'live') {
    const now = Math.floor(Date.now() / 1000);
    for (const [name, { maxAge }] of Object.entries(BUCKETS)) {
      const cutoff = now - maxAge;
      const map = cache[name];
      for (const k of map.keys()) {
        if (k < cutoff) map.delete(k);
        else break;
      }
    }
  }
}

// Load existing persisted candles into the in-memory cache on startup so the
// chart has full history (including 2s/5s/15s detail) the moment the server
// boots.
async function loadFromDb(cache) {
  try {
    const { getDb } = await import('./db/connection.js');
    const db = getDb();
    if (!db) return;
    const now    = Math.floor(Date.now() / 1000);
    const oldest = Math.max(...Object.values(BUCKETS).map(b => b.maxAge));
    const rows = await db`
      SELECT bucket, ts, open, high, low, close
      FROM eth_candles
      WHERE ts >= ${now - oldest}
      ORDER BY bucket, ts ASC`;
    for (const r of rows) {
      const map = cache[r.bucket];
      if (!map) continue;
      const { maxAge } = BUCKETS[r.bucket];
      if (Number(r.ts) < now - maxAge) continue;
      map.set(Number(r.ts), {
        ts:    Number(r.ts),
        open:  Number(r.open),
        high:  Number(r.high),
        low:   Number(r.low),
        close: Number(r.close),
      });
    }
    if (rows.length > 0) console.log(`[eth-candles] loaded ${rows.length} persisted candles`);

    // For any bucket that's still empty (or sparse) — also seed from the
    // 1-sample/min eth_price_snapshots so the 1m bucket has the full 2h of
    // history even on a fresh DB.
    const fallback = await db`
      SELECT timestamp::bigint AS ts, price_usd::float AS price
      FROM eth_price_snapshots
      WHERE timestamp >= ${now - oldest} AND price_usd IS NOT NULL
      ORDER BY timestamp ASC`;
    const dirty = {};
    for (const r of fallback) {
      const ts = Number(r.ts);
      const price = Number(r.price);
      if (!isFinite(price) || price <= 0) continue;
      recordSample(cache, ts, price, 'seed', dirty);
    }
    if (Object.keys(dirty).length) {
      // Persist any newly-created candles from the snapshot fallback so we
      // don't have to redo this work next restart.
      await flushDirty(db, cache, dirty);
    }
  } catch (err) {
    console.error('[eth-candles] db load error:', err.message);
  }
}

// Upsert the in-progress candles named in `dirty` for the given cache.
async function flushDirty(db, cache, dirty) {
  for (const [name, tsSet] of Object.entries(dirty)) {
    if (!tsSet || tsSet.size === 0) continue;
    const rows = [];
    for (const ts of tsSet) {
      const c = cache[name].get(ts);
      if (!c) continue;
      rows.push({ bucket: name, ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close });
    }
    if (!rows.length) continue;
    try {
      await db`
        INSERT INTO eth_candles ${db(rows)}
        ON CONFLICT(bucket, ts) DO UPDATE SET
          open  = EXCLUDED.open,
          high  = EXCLUDED.high,
          low   = EXCLUDED.low,
          close = EXCLUDED.close`;
    } catch (err) {
      console.error('[eth-candles] flush error:', err.message);
    }
  }
}

// Periodic pruning of rows older than each bucket's maxAge.
async function pruneDb() {
  try {
    const { getDb } = await import('./db/connection.js');
    const db = getDb();
    if (!db) return;
    const now = Math.floor(Date.now() / 1000);
    for (const [name, { maxAge }] of Object.entries(BUCKETS)) {
      await db`DELETE FROM eth_candles WHERE bucket = ${name} AND ts < ${now - maxAge}`;
    }
  } catch (err) {
    console.error('[eth-candles] prune error:', err.message);
  }
}

function ensureSingleton() {
  if (globalThis[GLOBAL_KEY]) return globalThis[GLOBAL_KEY];

  const cache = initCache();
  globalThis[GLOBAL_KEY] = cache;

  // Dirty-bucket tracker — Set of ts per bucket that changed since last flush.
  const dirty = {};
  for (const k of Object.keys(BUCKETS)) dirty[k] = new Set();

  // Subscribe to the live oracle feed (1-second polling). On each sample we
  // mutate the cache in-memory (sync) and mark the affected buckets dirty.
  // The dirty buckets get flushed by the background timer below — readers are
  // never blocked by DB writes.
  ethPriceFeed.subscribe((price) => {
    if (!isFinite(price) || price <= 0) return;
    recordSample(cache, Math.floor(Date.now() / 1000), price, 'live', dirty);
  });

  // Seed at least one sample if the feed already has a value (avoids an empty
  // cache flash before the first poll callback fires).
  const seed = ethPriceFeed.getLatest?.();
  if (seed && isFinite(seed) && seed > 0) {
    recordSample(cache, Math.floor(Date.now() / 1000), seed, 'seed', dirty);
  }

  // Async startup: load persisted candles from DB so the cache has full
  // history immediately. recordSample handles ordering / merges idempotently
  // so live ticks during this window are safe.
  loadFromDb(cache);

  // Background flush of dirty candles every 2s. Each loop drains the dirty
  // set, builds a multi-row UPSERT per bucket, fires it without awaiting on
  // the request-serving path.
  const flushTimer = setInterval(async () => {
    if (!Object.values(dirty).some(s => s.size > 0)) return;
    const snapshot = {};
    for (const [name, set] of Object.entries(dirty)) {
      if (set.size === 0) continue;
      snapshot[name] = new Set(set);
      set.clear();
    }
    try {
      const { getDb } = await import('./db/connection.js');
      const db = getDb();
      if (db) await flushDirty(db, cache, snapshot);
    } catch (err) {
      console.error('[eth-candles] flush timer error:', err.message);
    }
  }, 2_000);

  // Periodic prune (DB only — in-memory prunes on each live sample).
  const pruneTimer = setInterval(pruneDb, 60_000);

  // Stash the timers on the global so HMR cleanup can clear them.
  globalThis[GLOBAL_KEY + '_timers'] = { flushTimer, pruneTimer };

  return cache;
}

export function getEthCandles(bucket) {
  // Demo mode: never start the singleton — its 60s prune timer DELETEs
  // eth_candles rows older than 2h, which would erase the frozen dataset.
  if (process.env.DEMO_MODE === '1') return [];
  const cache = ensureSingleton();
  const map = cache[bucket];
  if (!map) return [];
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

export const SUPPORTED_BUCKETS = Object.keys(BUCKETS);
