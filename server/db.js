import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? join(__dirname, '..', 'offshore.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -32768');   // 32 MB page cache
db.pragma('mmap_size = 67108864'); // 64 MB mmap
db.pragma('wal_checkpoint(TRUNCATE)'); // clear any leftover WAL on startup

// Protocol/team addresses excluded from player emission charts
const PROTOCOL_ADDRS = [
  '0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462', // game deployer
].map(a => a.toLowerCase());

// SQL fragment used in all player-emission queries to exclude team mints
const NOT_PROTOCOL_MINT = `NOT (kind='MINT' AND to_addr IN (${PROTOCOL_ADDRS.map(() => '?').join(',')}))`;
const PROTOCOL_PARAMS = PROTOCOL_ADDRS;

// schema migrations for existing DBs
try { db.exec('ALTER TABLE supply_snapshots ADD COLUMN holders INTEGER'); } catch {}

// If transfers table exists without log_index (old schema), drop it so it gets
// recreated with the correct composite primary key and resynced from RPC.
try {
  const cols = db.prepare("PRAGMA table_info(transfers)").all().map(c => c.name);
  if (cols.length > 0 && !cols.includes('log_index')) {
    console.log('[db] old schema detected — dropping transfers + influence_transfers for resync');
    db.exec('DROP TABLE IF EXISTS transfers');
    db.exec('DROP TABLE IF EXISTS influence_transfers');
    db.exec("DELETE FROM meta WHERE key IN ('last_block','last_influence_block')");
  }
} catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS transfers (
    hash        TEXT    NOT NULL,
    log_index   INTEGER NOT NULL DEFAULT 0,
    block_num   INTEGER NOT NULL,
    timestamp   INTEGER NOT NULL,
    from_addr   TEXT    NOT NULL,
    to_addr     TEXT    NOT NULL,
    raw_value   TEXT    NOT NULL,
    amount      REAL    NOT NULL,
    kind        TEXT    NOT NULL,
    op_type     TEXT    NOT NULL,
    PRIMARY KEY (hash, log_index)
  );
  CREATE INDEX IF NOT EXISTS idx_ts       ON transfers(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_block    ON transfers(block_num DESC);
  CREATE INDEX IF NOT EXISTS idx_from     ON transfers(from_addr);
  CREATE INDEX IF NOT EXISTS idx_to       ON transfers(to_addr);
  CREATE INDEX IF NOT EXISTS idx_kind     ON transfers(kind);
  CREATE INDEX IF NOT EXISTS idx_kind_to  ON transfers(kind, to_addr);
  CREATE INDEX IF NOT EXISTS idx_hash_only ON transfers(hash);

  CREATE TABLE IF NOT EXISTS supply_snapshots (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    supply    REAL    NOT NULL,
    holders   INTEGER
  );

  CREATE TABLE IF NOT EXISTS eth_price_snapshots (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    price_usd REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS influence_supply_snapshots (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    supply    REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vault_payouts (
    hash      TEXT    NOT NULL,
    log_index INTEGER NOT NULL DEFAULT 0,
    block_num INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    recipient TEXT    NOT NULL,
    amount    REAL    NOT NULL,
    PRIMARY KEY (hash, log_index)
  );
  CREATE INDEX IF NOT EXISTS idx_vault_ts   ON vault_payouts(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_vault_recp ON vault_payouts(recipient);

  CREATE TABLE IF NOT EXISTS influence_transfers (
    hash      TEXT    NOT NULL,
    log_index INTEGER NOT NULL DEFAULT 0,
    block_num INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    from_addr TEXT    NOT NULL,
    to_addr   TEXT    NOT NULL,
    amount    REAL    NOT NULL,
    kind      TEXT    NOT NULL,
    PRIMARY KEY (hash, log_index)
  );
  CREATE INDEX IF NOT EXISTS idx_inf_ts    ON influence_transfers(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_inf_block ON influence_transfers(block_num DESC);
  CREATE INDEX IF NOT EXISTS idx_inf_kind  ON influence_transfers(kind);
  CREATE INDEX IF NOT EXISTS idx_inf_hash  ON influence_transfers(hash);

  CREATE TABLE IF NOT EXISTS token_holders (
    address      TEXT    PRIMARY KEY,
    balance      REAL    NOT NULL,
    balance_raw  TEXT    NOT NULL,
    rank         INTEGER NOT NULL,
    is_contract  INTEGER NOT NULL DEFAULT 0,
    last_snapshot INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ─── transfers ────────────────────────────────────────────────────────────────

const _insertTx = db.prepare(`
  INSERT OR IGNORE INTO transfers
    (hash, log_index, block_num, timestamp, from_addr, to_addr, raw_value, amount, kind, op_type)
  VALUES
    (@hash, @logIndex, @blockNum, @timestamp, @fromAddr, @toAddr, @rawValue, @amount, @kind, @opType)
`);

export const upsertTransfers = db.transaction((rows) => {
  for (const row of rows) _insertTx.run(row);
  if (rows.length > 500) db.pragma('wal_checkpoint(PASSIVE)');
});

export function getLastBlock() {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('last_block');
  return row ? parseInt(row.value, 10) : 0;
}

export function setLastBlock(n) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('last_block', String(n));
}

export function getRecentTransfers(limit = 100, offset = 0) {
  return db.prepare(
    'SELECT * FROM transfers ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

export function getStats() {
  const mints  = db.prepare(`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total FROM transfers WHERE kind='MINT' AND ${NOT_PROTOCOL_MINT}`).get(...PROTOCOL_PARAMS);
  const spends = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM transfers WHERE kind IN ('SPEND','BURN')`).get();
  // Use mint recipients only — fast via idx_kind_to, avoids double full-scan
  const addrs  = db.prepare(`SELECT COUNT(DISTINCT to_addr) AS cnt FROM transfers WHERE kind='MINT' AND to_addr != ?`).get(ZERO_ADDR);
  return {
    opsTotal:         mints.cnt,
    dirtyMintedTotal: mints.total,
    dirtySpentTotal:  spends.total,
    uniqueAddrs:      addrs.cnt,
  };
}

function _flowBuckets(unit, startTs) {
  const now      = Math.floor(Date.now() / 1000);
  const numSlots = Math.floor((now - startTs) / unit) + 1;

  const rows = db.prepare(`
    SELECT
      CAST((timestamp - ?) / ${unit} AS INTEGER)                               AS slot,
      CAST(SUM(CASE WHEN kind='MINT' AND ${NOT_PROTOCOL_MINT} THEN amount ELSE 0 END) AS INTEGER) AS minted,
      CAST(SUM(CASE WHEN kind IN ('SPEND','BURN')              THEN amount ELSE 0 END) AS INTEGER) AS spent,
      CAST(SUM(CASE WHEN kind='MINT' AND NOT (${NOT_PROTOCOL_MINT}) THEN amount ELSE 0 END) AS INTEGER) AS protocol_mint
    FROM transfers
    WHERE kind IN ('MINT','SPEND','BURN')
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs, ...PROTOCOL_PARAMS, ...PROTOCOL_PARAMS);

  const rowMap = new Map(rows.map(r => [r.slot, r]));

  return Array.from({ length: numSlots }, (_, i) => {
    const ts = new Date((startTs + i * unit) * 1000);
    const label = unit === 3600
      ? `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}h`
      : `${ts.getMonth() + 1}/${ts.getDate()}`;
    const r = rowMap.get(i);
    const minted       = r?.minted       ?? 0;
    const spent        = r?.spent        ?? 0;
    const protocolMint = r?.protocol_mint ?? 0;
    return { label, minted, spent, net: minted - spent, protocolMint };
  });
}

export function getDailyFlowBuckets() {
  const first = db.prepare("SELECT MIN(timestamp) AS ts FROM transfers WHERE kind IN ('MINT','SPEND','BURN')").get();
  if (!first?.ts) return [];
  return _flowBuckets(86400, Math.floor(first.ts / 86400) * 86400);
}

export function getHourlyFlowBuckets() {
  const first = db.prepare("SELECT MIN(timestamp) AS ts FROM transfers WHERE kind IN ('MINT','SPEND','BURN')").get();
  if (!first?.ts) return [];
  return _flowBuckets(3600, first.ts);
}

function _burnBuckets(groupExpr, startTs) {
  const now     = Math.floor(Date.now() / 1000);
  const unit    = groupExpr === 'hour' ? 3600 : 86400;
  const numSlots = Math.floor((now - startTs) / unit) + 1;

  const rows = db.prepare(`
    SELECT
      CAST((timestamp - ?) / ${unit} AS INTEGER)                               AS slot,
      CAST(SUM(CASE WHEN kind='BURN'                    THEN amount ELSE 0 END) AS INTEGER) AS burned,
      CAST(SUM(CASE WHEN op_type='BUY_ASSET'            THEN amount ELSE 0 END) AS INTEGER) AS assets,
      CAST(SUM(CASE WHEN op_type='LEVEL_UP'             THEN amount ELSE 0 END) AS INTEGER) AS levels,
      CAST(SUM(CASE WHEN op_type='THIRD_ENTERPRISE'     THEN amount ELSE 0 END) AS INTEGER) AS enterprise
    FROM transfers WHERE kind IN ('BURN', 'SPEND')
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs);

  const rowMap = new Map(rows.map(r => [r.slot, r]));

  return Array.from({ length: numSlots }, (_, i) => {
    const ts = new Date((startTs + i * unit) * 1000);
    const label = groupExpr === 'hour'
      ? `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}h`
      : `${ts.getMonth() + 1}/${ts.getDate()}`;
    const r = rowMap.get(i);
    return { label, burned: r?.burned ?? 0, assets: r?.assets ?? 0, levels: r?.levels ?? 0, enterprise: r?.enterprise ?? 0 };
  });
}

export function getDailyBurnBuckets() {
  const first = db.prepare("SELECT MIN(timestamp) AS ts FROM transfers WHERE kind IN ('BURN','SPEND')").get();
  if (!first?.ts) return [];
  return _burnBuckets('day', Math.floor(first.ts / 86400) * 86400);
}

export function getHourlyBurnBuckets() {
  const first = db.prepare("SELECT MIN(timestamp) AS ts FROM transfers WHERE kind IN ('BURN','SPEND')").get();
  if (!first?.ts) return [];
  return _burnBuckets('hour', first.ts);
}

// Group mints by hour from the first ever mint to now
export function getHourlyBuckets() {
  const first = db.prepare("SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT'").get();
  if (!first?.ts) return [];

  const startTs  = first.ts;
  const now      = Math.floor(Date.now() / 1000);
  const numHours = Math.floor((now - startTs) / 3600) + 1;

  const rows = db.prepare(`
    SELECT
      CAST((timestamp - ?) / 3600 AS INTEGER) AS hour_idx,
      COUNT(*)                                 AS mints,
      CAST(SUM(amount) AS INTEGER)             AS dirty
    FROM transfers
    WHERE kind = 'MINT' AND ${NOT_PROTOCOL_MINT}
    GROUP BY hour_idx ORDER BY hour_idx ASC
  `).all(startTs, ...PROTOCOL_PARAMS);

  const rowMap = new Map(rows.map(r => [r.hour_idx, r]));

  return Array.from({ length: numHours }, (_, i) => {
    const ts = new Date((startTs + i * 3600) * 1000);
    const label = `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}h`;
    const r = rowMap.get(i);
    return { label, mints: r?.mints ?? 0, dirty: r?.dirty ?? 0 };
  });
}

// Group mints by calendar day from the first ever mint to today
export function getDailyBuckets() {
  const first = db.prepare("SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT'").get();
  if (!first?.ts) return [];

  const startDay = Math.floor(first.ts / 86400) * 86400;
  const now      = Math.floor(Date.now() / 1000);
  const numDays  = Math.floor((now - startDay) / 86400) + 1;

  const rows = db.prepare(`
    SELECT
      CAST((timestamp - ?) / 86400 AS INTEGER) AS day_idx,
      COUNT(*)                                  AS mints,
      CAST(SUM(amount) AS INTEGER)              AS dirty
    FROM transfers
    WHERE kind = 'MINT' AND ${NOT_PROTOCOL_MINT}
    GROUP BY day_idx ORDER BY day_idx ASC
  `).all(startDay, ...PROTOCOL_PARAMS);

  const rowMap = new Map(rows.map(r => [r.day_idx, r]));

  return Array.from({ length: numDays }, (_, i) => {
    const ts = (startDay + i * 86400) * 1000;
    const d  = new Date(ts);
    const r  = rowMap.get(i);
    return {
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      mints: r?.mints ?? 0,
      dirty: r?.dirty ?? 0,
    };
  });
}

function _opBreakdownBuckets(unit) {
  const first = db.prepare("SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT'").get();
  if (!first?.ts) return [];

  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : first.ts;
  const now      = Math.floor(Date.now() / 1000);
  const numSlots = Math.floor((now - startTs) / unit) + 1;

  const rows = db.prepare(`
    SELECT
      CAST((timestamp - ?) / ${unit} AS INTEGER)                                       AS slot,
      COUNT(CASE WHEN op_type='EXTORTION' THEN 1 END)                                 AS extortion,
      COUNT(CASE WHEN op_type='ARMS_DEAL' THEN 1 END)                                 AS arms_deal,
      COUNT(CASE WHEN op_type='DRUG_DEAL' THEN 1 END)                                 AS drug_deal,
      COUNT(CASE WHEN op_type='PARTIAL'   THEN 1 END)                                 AS partial,
      CAST(SUM(CASE WHEN op_type='EXTORTION' THEN amount ELSE 0 END) AS INTEGER)      AS extortion_dirty,
      CAST(SUM(CASE WHEN op_type='ARMS_DEAL' THEN amount ELSE 0 END) AS INTEGER)      AS arms_deal_dirty,
      CAST(SUM(CASE WHEN op_type='DRUG_DEAL' THEN amount ELSE 0 END) AS INTEGER)      AS drug_deal_dirty,
      CAST(SUM(CASE WHEN op_type='PARTIAL'   THEN amount ELSE 0 END) AS INTEGER)      AS partial_dirty
    FROM transfers
    WHERE kind = 'MINT' AND ${NOT_PROTOCOL_MINT}
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs, ...PROTOCOL_PARAMS);

  const rowMap = new Map(rows.map(r => [r.slot, r]));

  return Array.from({ length: numSlots }, (_, i) => {
    const ts = new Date((startTs + i * unit) * 1000);
    const label = unit === 3600
      ? `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}h`
      : `${ts.getMonth() + 1}/${ts.getDate()}`;
    const r = rowMap.get(i);
    return {
      label,
      extortion:      r?.extortion       ?? 0,
      armsDeal:       r?.arms_deal       ?? 0,
      drugDeal:       r?.drug_deal       ?? 0,
      partial:        r?.partial         ?? 0,
      extortionDirty: r?.extortion_dirty ?? 0,
      armsDealDirty:  r?.arms_deal_dirty ?? 0,
      drugDealDirty:  r?.drug_deal_dirty ?? 0,
      partialDirty:   r?.partial_dirty   ?? 0,
    };
  });
}

export function getDailyOpBreakdown()  { return _opBreakdownBuckets(86400); }
export function getHourlyOpBreakdown() { return _opBreakdownBuckets(3600);  }

function _activeWalletBuckets(unit) {
  const first = db.prepare("SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT'").get();
  if (!first?.ts) return [];

  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : first.ts;
  const now      = Math.floor(Date.now() / 1000);
  const numSlots = Math.floor((now - startTs) / unit) + 1;

  const rows = db.prepare(`
    SELECT
      CAST((timestamp - ?) / ${unit} AS INTEGER) AS slot,
      COUNT(DISTINCT addr)                        AS active_wallets
    FROM (
      SELECT to_addr   AS addr, timestamp FROM transfers WHERE kind = 'MINT'   AND ${NOT_PROTOCOL_MINT}
      UNION ALL
      SELECT from_addr AS addr, timestamp FROM transfers WHERE kind IN ('SPEND','BURN')
    )
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs, ...PROTOCOL_PARAMS);

  const rowMap = new Map(rows.map(r => [r.slot, r.active_wallets]));

  return Array.from({ length: numSlots }, (_, i) => {
    const ts = new Date((startTs + i * unit) * 1000);
    const label = unit === 3600
      ? `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}h`
      : `${ts.getMonth() + 1}/${ts.getDate()}`;
    return { label, activeWallets: rowMap.get(i) ?? 0 };
  });
}

export function getDailyActiveWallets()  { return _activeWalletBuckets(86400); }
export function getHourlyActiveWallets() { return _activeWalletBuckets(3600);  }

export function getTopEarners(limit = 100) {
  return db.prepare(`
    SELECT to_addr AS addr, SUM(amount) AS total, COUNT(*) AS ops
    FROM transfers WHERE kind='MINT' AND ${NOT_PROTOCOL_MINT}
    GROUP BY to_addr ORDER BY total DESC LIMIT ?
  `).all(...PROTOCOL_PARAMS, limit);
}

export function getOpBreakdown() {
  const rows = db.prepare(`SELECT op_type, COUNT(*) AS cnt FROM transfers WHERE kind='MINT' AND ${NOT_PROTOCOL_MINT} GROUP BY op_type`).all(...PROTOCOL_PARAMS);
  const out = { DRUG_DEAL: 0, ARMS_DEAL: 0, EXTORTION: 0, PARTIAL: 0 };
  rows.forEach(r => { if (r.op_type in out) out[r.op_type] = r.cnt; });
  return out;
}

// ─── holder balance computation (from Transfer events — no external API) ──────

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// Compute current balances for all addresses from Transfer event history.
// Returns rows sorted by balance DESC.
export function computeHolderBalances(limit = 500) {
  return db.prepare(`
    SELECT addr, SUM(delta) AS balance
    FROM (
      SELECT to_addr   AS addr,  amount AS delta FROM transfers WHERE to_addr   != ?
      UNION ALL
      SELECT from_addr AS addr, -amount AS delta FROM transfers WHERE from_addr != ?
    )
    GROUP BY addr
    HAVING balance > 0.000001
    ORDER BY balance DESC
    LIMIT ?
  `).all(ZERO_ADDR, ZERO_ADDR, limit);
}

// Count of all addresses with a non-zero DIRTY balance (true holder count).
export function computeTrueHolderCount() {
  return db.prepare(`
    SELECT COUNT(*) AS cnt FROM (
      SELECT addr, SUM(delta) AS balance
      FROM (
        SELECT to_addr   AS addr,  amount AS delta FROM transfers WHERE to_addr   != ?
        UNION ALL
        SELECT from_addr AS addr, -amount AS delta FROM transfers WHERE from_addr != ?
      )
      GROUP BY addr
      HAVING balance > 0.000001
    )
  `).get(ZERO_ADDR, ZERO_ADDR).cnt;
}

// Returns a Map<address, isContract (0|1)> for addresses already in token_holders.
export function getKnownIsContract() {
  const rows = db.prepare('SELECT address, is_contract FROM token_holders').all();
  return new Map(rows.map(r => [r.address, r.is_contract]));
}

// ─── holders / whales ─────────────────────────────────────────────────────────

const _insertHolder = db.prepare(`
  INSERT OR REPLACE INTO token_holders (address, balance, balance_raw, rank, is_contract, last_snapshot)
  VALUES (@address, @balance, @balanceRaw, @rank, @isContract, @lastSnapshot)
`);

export const upsertHolders = db.transaction((rows) => {
  db.prepare('DELETE FROM token_holders').run();
  for (const row of rows) _insertHolder.run(row);
});

// Prepared statements for per-wallet stats (called N times — must be reusable)
const _mintStats = db.prepare(`
  SELECT
    COALESCE(SUM(amount),0)                                          AS total_minted,
    COUNT(*)                                                          AS total_ops,
    COALESCE(SUM(CASE WHEN timestamp>=? THEN amount ELSE 0 END),0)   AS dirty_24h,
    COALESCE(SUM(CASE WHEN timestamp>=? THEN 1     ELSE 0 END),0)    AS ops_24h,
    MAX(timestamp)                                                    AS last_mint
  FROM transfers WHERE kind='MINT' AND to_addr=?
`);

const _spendStats = db.prepare(`
  SELECT COALESCE(SUM(amount),0) AS total_spent, MAX(timestamp) AS last_spend
  FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr=?
`);

const _favOp = db.prepare(`
  SELECT op_type FROM transfers WHERE kind='MINT' AND to_addr=?
  GROUP BY op_type ORDER BY COUNT(*) DESC LIMIT 1
`);

export function getWhales(limit = 25, excludeAddresses = []) {
  const since  = Math.floor(Date.now() / 1000) - 86400;
  const excluded = excludeAddresses.map(a => a.toLowerCase());
  const all    = db.prepare('SELECT * FROM token_holders ORDER BY rank ASC').all();
  const whales = all.filter(w => !excluded.includes(w.address)).slice(0, limit);

  return whales.map(w => {
    const mint  = _mintStats.get(since, since, w.address);
    const spend = _spendStats.get(w.address);
    const fav   = _favOp.get(w.address);
    const lastActive = Math.max(mint.last_mint ?? 0, spend.last_spend ?? 0);
    return {
      rank:         w.rank,
      address:      w.address,
      balance:      w.balance,
      isContract:   w.is_contract === 1,
      totalMinted:  mint.total_minted,
      totalOps:     mint.total_ops,
      totalSpent:   spend.total_spent,
      dirty24h:     mint.dirty_24h,
      ops24h:       mint.ops_24h,
      favOp:        fav?.op_type ?? null,
      lastActive,
    };
  });
}

export function getHolderCount() {
  return db.prepare('SELECT COUNT(*) AS cnt FROM token_holders').get().cnt;
}

// ─── snapshots ────────────────────────────────────────────────────────────────

// Returns end-of-day blocks for days that have no supply snapshot yet
export function getDaysNeedingSupplyBackfill() {
  return db.prepare(`
    SELECT
      DATE(t.timestamp,'unixepoch') AS day,
      MAX(t.block_num)              AS block_num,
      MAX(t.timestamp)              AS day_ts
    FROM transfers t
    WHERE NOT EXISTS (
      SELECT 1 FROM supply_snapshots s
      WHERE DATE(s.timestamp,'unixepoch') = DATE(t.timestamp,'unixepoch')
    )
    GROUP BY day
    ORDER BY day ASC
  `).all();
}

// Returns end-of-hour blocks for hours that have no supply snapshot yet
export function getHoursNeedingSupplyBackfill() {
  return db.prepare(`
    SELECT
      STRFTIME('%Y-%m-%d %H',t.timestamp,'unixepoch') AS hour,
      MAX(t.block_num)                                 AS block_num,
      MAX(t.timestamp)                                 AS hour_ts
    FROM transfers t
    WHERE NOT EXISTS (
      SELECT 1 FROM supply_snapshots s
      WHERE STRFTIME('%Y-%m-%d %H',s.timestamp,'unixepoch')
          = STRFTIME('%Y-%m-%d %H',t.timestamp,'unixepoch')
    )
    GROUP BY hour
    ORDER BY hour ASC
  `).all();
}

export function getDailySupplyHistory() {
  return db.prepare(`
    SELECT
      CAST(STRFTIME('%m',timestamp,'unixepoch') AS INTEGER)
        || '/' ||
      CAST(STRFTIME('%d',timestamp,'unixepoch') AS INTEGER) AS label,
      supply
    FROM (
      SELECT timestamp, supply,
        ROW_NUMBER() OVER (
          PARTITION BY DATE(timestamp,'unixepoch')
          ORDER BY timestamp DESC
        ) AS rn
      FROM supply_snapshots
    )
    WHERE rn = 1
    ORDER BY timestamp ASC
  `).all();
}

export function getHourlySupplyHistory() {
  return db.prepare(`
    SELECT
      STRFTIME('%m/%d %Hh', timestamp, 'unixepoch') AS label,
      supply
    FROM (
      SELECT timestamp, supply,
        ROW_NUMBER() OVER (
          PARTITION BY STRFTIME('%Y-%m-%d %H', timestamp, 'unixepoch')
          ORDER BY timestamp DESC
        ) AS rn
      FROM supply_snapshots
    )
    WHERE rn = 1
    ORDER BY timestamp ASC
  `).all();
}

export function saveTokenInfoSnapshot(supply, holders, ts) {
  db.prepare('INSERT OR IGNORE INTO supply_snapshots (timestamp, supply, holders) VALUES (?, ?, ?)')
    .run(ts ?? Math.floor(Date.now() / 1000), supply, holders ?? null);
}

export function saveEthPriceSnapshot(price) {
  db.prepare('INSERT INTO eth_price_snapshots (timestamp, price_usd) VALUES (?, ?)')
    .run(Math.floor(Date.now() / 1000), price);
}

export function getLatestTokenInfo() {
  const latest = db.prepare('SELECT supply, holders FROM supply_snapshots ORDER BY timestamp DESC LIMIT 1').get()
    ?? { supply: null, holders: null };
  if (latest.holders == null) {
    // Backfill snapshots don't store holders — find the most recent one that does
    const withHolders = db.prepare('SELECT holders FROM supply_snapshots WHERE holders IS NOT NULL ORDER BY timestamp DESC LIMIT 1').get();
    latest.holders = withHolders?.holders ?? null;
  }
  return latest;
}

export function getLatestEthPrice() {
  return db.prepare('SELECT price_usd FROM eth_price_snapshots ORDER BY timestamp DESC LIMIT 1').get()?.price_usd ?? null;
}

export function getSupplyHistory(hours = 24) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  return db.prepare('SELECT timestamp, supply FROM supply_snapshots WHERE timestamp>=? ORDER BY timestamp ASC').all(since);
}

export function getEthPriceHistory(hours = 24) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  return db.prepare('SELECT timestamp, price_usd FROM eth_price_snapshots WHERE timestamp>=? ORDER BY timestamp ASC').all(since);
}


const LP_POOL = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';

const LP_POOL_ADDR = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';

// DEX swaps involving any of the top N tracked whale wallets
export function getDexActivity(since = 0, limit = 50, whaleLimit = 200) {
  const whales = db.prepare('SELECT address FROM token_holders ORDER BY rank ASC LIMIT ?').all(whaleLimit).map(r => r.address);
  if (!whales.length) return [];
  const ph = whales.map(() => '?').join(',');
  return db.prepare(`
    SELECT *
    FROM transfers
    WHERE kind = 'TRANSFER'
      AND (from_addr = '${LP_POOL_ADDR}' OR to_addr = '${LP_POOL_ADDR}')
      AND (from_addr IN (${ph}) OR to_addr IN (${ph}))
      AND timestamp > ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...whales, ...whales, since, limit);
}

export function getWalletDexSummary(addresses) {
  if (!addresses.length) return {};
  const ph = addresses.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT
      CASE WHEN to_addr   = '${LP_POOL}' THEN from_addr ELSE to_addr END AS wallet,
      CASE WHEN to_addr   = '${LP_POOL}' THEN 'sell' ELSE 'buy' END      AS side,
      COUNT(*)                                                              AS cnt,
      CAST(SUM(amount) AS INTEGER)                                         AS total
    FROM transfers
    WHERE kind = 'TRANSFER'
      AND (from_addr = '${LP_POOL}' OR to_addr = '${LP_POOL}')
      AND (from_addr IN (${ph}) OR to_addr IN (${ph}))
    GROUP BY wallet, side
  `).all(...addresses, ...addresses);
  const out = {};
  for (const r of rows) {
    if (!out[r.wallet]) out[r.wallet] = { sells: 0, sellTotal: 0, buys: 0, buyTotal: 0 };
    if (r.side === 'sell') { out[r.wallet].sells = r.cnt; out[r.wallet].sellTotal = r.total; }
    else                   { out[r.wallet].buys  = r.cnt; out[r.wallet].buyTotal  = r.total; }
  }
  return out;
}

export function getWalletActivity(addresses, limit = 100, since = 0) {
  if (!addresses.length) return [];
  const ph = addresses.map(() => '?').join(',');
  return db.prepare(`
    SELECT *
    FROM transfers
    WHERE (from_addr IN (${ph}) OR to_addr IN (${ph}))
      AND (
        kind IN ('MINT','SPEND','BURN')
        OR (kind='TRANSFER' AND (from_addr='${LP_POOL}' OR to_addr='${LP_POOL}'))
      )
      AND timestamp > ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(...addresses, ...addresses, since, limit);
}

export function getTotalTransferCount() {
  return db.prepare('SELECT COUNT(*) AS cnt FROM transfers').get().cnt;
}

// ─── new participants ─────────────────────────────────────────────────────────

function _participantBuckets(unit) {
  // Use only MINT events: first DIRTY earn = first time a wallet becomes a participant.
  // idx_kind_to index makes this fast without a full table scan.
  const first = db.prepare(
    `SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT' AND to_addr != ?`
  ).get(ZERO_ADDR);
  if (!first?.ts) return [];

  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : first.ts;
  const now      = Math.floor(Date.now() / 1000);
  const numSlots = Math.floor((now - startTs) / unit) + 1;

  const rows = db.prepare(`
    SELECT slot, COUNT(*) AS new_wallets FROM (
      SELECT CAST((MIN(timestamp) - ?) / ${unit} AS INTEGER) AS slot
      FROM transfers WHERE kind='MINT' AND to_addr != ?
      GROUP BY to_addr
    ) GROUP BY slot ORDER BY slot ASC
  `).all(startTs, ZERO_ADDR);

  const rowMap = new Map(rows.map(r => [r.slot, r.new_wallets]));

  return Array.from({ length: numSlots }, (_, i) => {
    const ts = new Date((startTs + i * unit) * 1000);
    const label = unit === 3600
      ? `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}h`
      : `${ts.getMonth() + 1}/${ts.getDate()}`;
    return { label, newWallets: rowMap.get(i) ?? 0 };
  });
}

export function getDailyNewParticipants()  { return _participantBuckets(86400); }
export function getHourlyNewParticipants() { return _participantBuckets(3600);  }

// ─── influence transfers ───────────────────────────────────────────────────────

const _insertInfluence = db.prepare(`
  INSERT OR IGNORE INTO influence_transfers
    (hash, log_index, block_num, timestamp, from_addr, to_addr, amount, kind)
  VALUES (@hash, @logIndex, @blockNum, @timestamp, @fromAddr, @toAddr, @amount, @kind)
`);

export const upsertInfluenceTransfers = db.transaction((rows) => {
  for (const row of rows) _insertInfluence.run(row);
});

export function getLastInfluenceBlock() {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('last_influence_block');
  return row ? parseInt(row.value, 10) : 0;
}

export function setLastInfluenceBlock(n) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('last_influence_block', String(n));
}

function _influenceBuckets(unit, startTs) {
  const now      = Math.floor(Date.now() / 1000);
  const numSlots = Math.floor((now - startTs) / unit) + 1;

  const rows = db.prepare(`
    SELECT
      CAST((timestamp - ?) / ${unit} AS INTEGER) AS slot,
      CAST(SUM(CASE WHEN kind='MINT' THEN amount ELSE 0 END) AS INTEGER) AS minted,
      CAST(SUM(CASE WHEN kind='BURN' THEN amount ELSE 0 END) AS INTEGER) AS burned,
      CAST(SUM(CASE WHEN kind='MINT'
        AND NOT EXISTS (SELECT 1 FROM transfers d WHERE d.hash = influence_transfers.hash LIMIT 1)
        THEN amount ELSE 0 END) AS INTEGER) AS purchased
    FROM influence_transfers
    WHERE kind IN ('MINT','BURN') AND timestamp > 0
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs);

  const rowMap = new Map(rows.map(r => [r.slot, r]));

  return Array.from({ length: numSlots }, (_, i) => {
    const ts = new Date((startTs + i * unit) * 1000);
    const label = unit === 3600
      ? `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}h`
      : `${ts.getMonth() + 1}/${ts.getDate()}`;
    const r = rowMap.get(i);
    return {
      label,
      minted:    r?.minted    ?? 0,
      burned:    r?.burned    ?? 0,
      purchased: r?.purchased ?? 0,
    };
  });
}

export function getDailyInfluenceBuckets() {
  const first = db.prepare("SELECT MIN(timestamp) AS ts FROM influence_transfers WHERE kind IN ('MINT','BURN') AND timestamp > 0").get();
  if (!first?.ts) return [];
  return _influenceBuckets(86400, Math.floor(first.ts / 86400) * 86400);
}

export function getHourlyInfluenceBuckets() {
  const first = db.prepare("SELECT MIN(timestamp) AS ts FROM influence_transfers WHERE kind IN ('MINT','BURN') AND timestamp > 0").get();
  if (!first?.ts) return [];
  return _influenceBuckets(3600, first.ts);
}

export function saveInfluenceSupply(supply) {
  db.prepare('INSERT INTO influence_supply_snapshots (timestamp, supply) VALUES (?, ?)')
    .run(Math.floor(Date.now() / 1000), supply);
}

export function getLatestInfluenceSupply() {
  return db.prepare('SELECT supply FROM influence_supply_snapshots ORDER BY timestamp DESC LIMIT 1')
    .get()?.supply ?? null;
}

export function getInfluenceStats() {
  const r = db.prepare(`
    SELECT
      CAST(SUM(CASE WHEN kind='MINT' THEN amount ELSE 0 END) AS INTEGER) AS total_minted,
      CAST(SUM(CASE WHEN kind='BURN' THEN amount ELSE 0 END) AS INTEGER) AS total_burned,
      COUNT(DISTINCT CASE WHEN kind='MINT' THEN to_addr END)             AS unique_earners,
      CAST(SUM(CASE WHEN kind='MINT'
        AND EXISTS (SELECT 1 FROM transfers d WHERE d.hash = influence_transfers.hash LIMIT 1)
        THEN amount ELSE 0 END) AS INTEGER) AS total_refunded,
      CAST(SUM(CASE WHEN kind='MINT'
        AND NOT EXISTS (SELECT 1 FROM transfers d WHERE d.hash = influence_transfers.hash LIMIT 1)
        THEN amount ELSE 0 END) AS INTEGER) AS total_purchased
    FROM influence_transfers WHERE timestamp > 0
  `).get();
  return {
    totalMinted:    r.total_minted    ?? 0,
    totalBurned:    r.total_burned    ?? 0,
    totalRefunded:  r.total_refunded  ?? 0,
    totalPurchased: r.total_purchased ?? 0,
    circulating:    getLatestInfluenceSupply(),
    uniqueEarners:  r.unique_earners  ?? 0,
  };
}

// ─── swiss vault ──────────────────────────────────────────────────────────────

const ZERO_ADDR_VAULT = '0x0000000000000000000000000000000000000000';

const _insertVaultPayout = db.prepare(`
  INSERT OR IGNORE INTO vault_payouts (hash, log_index, block_num, timestamp, recipient, amount)
  VALUES (@hash, @logIndex, @blockNum, @timestamp, @recipient, @amount)
`);

export const upsertVaultPayouts = db.transaction((rows) => {
  for (const row of rows) _insertVaultPayout.run(row);
});

export function getLastVaultBlock() {
  const row = db.prepare("SELECT value FROM meta WHERE key='last_vault_block'").get();
  return row ? parseInt(row.value, 10) : 0;
}

export function setLastVaultBlock(n) {
  db.prepare("INSERT OR REPLACE INTO meta (key,value) VALUES ('last_vault_block',?)").run(String(n));
}

export function getVaultStats() {
  const total = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN recipient != ? THEN amount ELSE 0 END),0) AS distributed,
      COALESCE(SUM(CASE WHEN recipient  = ? THEN amount ELSE 0 END),0) AS burned,
      COUNT(DISTINCT CASE WHEN recipient != ? THEN recipient END)       AS unique_recipients,
      COUNT(DISTINCT CASE WHEN recipient != ? THEN CAST((timestamp - 5400) / 28800 AS INTEGER) END) AS cycles_paid
    FROM vault_payouts
  `).get(ZERO_ADDR_VAULT, ZERO_ADDR_VAULT, ZERO_ADDR_VAULT, ZERO_ADDR_VAULT);
  return {
    distributed:      total.distributed,
    burned:           total.burned,
    uniqueRecipients: total.unique_recipients,
    cyclesPaid:       total.cycles_paid,
  };
}

const WEEKDAY_PHASE  = 5400;
const WEEKEND_ANCHOR = 9 * 3600 + 30 * 60;
const WEEKDAY_DUR    = 8  * 3600;
const WEEKEND_DUR    = 24 * 3600;

function isWeekendTs(ts) {
  const d        = new Date(ts * 1000);
  const dow      = d.getUTCDay();
  const secInDay = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  if (dow === 6 && secInDay >= WEEKEND_ANCHOR) return true;
  if (dow === 0) return true;
  if (dow === 1 && secInDay <  WEEKEND_ANCHOR) return true;
  return false;
}

function cycleStartTs(ts) {
  if (isWeekendTs(ts)) {
    return Math.floor((ts - WEEKEND_ANCHOR) / WEEKEND_DUR) * WEEKEND_DUR + WEEKEND_ANCHOR;
  }
  return Math.floor((ts - WEEKDAY_PHASE) / WEEKDAY_DUR) * WEEKDAY_DUR + WEEKDAY_PHASE;
}

export function getVaultCycleHistory() {
  const rows = db.prepare(`
    SELECT timestamp, recipient, amount FROM vault_payouts ORDER BY timestamp ASC
  `).all();

  const cycles = new Map();
  for (const row of rows) {
    const cs = cycleStartTs(row.timestamp);
    if (!cycles.has(cs)) cycles.set(cs, { distributed: 0, burned: 0, recipients: new Set() });
    const c = cycles.get(cs);
    if (row.recipient === ZERO_ADDR_VAULT) {
      c.burned += row.amount;
    } else {
      c.distributed += row.amount;
      c.recipients.add(row.recipient);
    }
  }

  return [...cycles.entries()].sort((a, b) => a[0] - b[0]).map(([cs, c]) => {
    const d = new Date(cs * 1000);
    const weekend = isWeekendTs(cs);
    return {
      label:       `${d.getUTCMonth()+1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2,'0')}h`,
      timestamp:   cs,
      distributed: Math.round(c.distributed),
      burned:      Math.round(c.burned),
      recipients:  c.recipients.size,
      isWeekend:   weekend,
    };
  });
}

export function getVaultTopEarners(limit = 50) {
  return db.prepare(`
    SELECT recipient AS addr, SUM(amount) AS total, COUNT(*) AS payouts
    FROM vault_payouts
    WHERE recipient != ?
    GROUP BY recipient
    ORDER BY total DESC
    LIMIT ?
  `).all(ZERO_ADDR_VAULT, limit);
}

export function getVaultRecentPayouts(limit = 100) {
  return db.prepare(`
    SELECT hash, log_index, timestamp, recipient, amount
    FROM vault_payouts
    WHERE recipient != ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(ZERO_ADDR_VAULT, limit);
}

// ─── player stats & activity ─────────────────────────────────────────────────

const LP       = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';
const ZERO_P   = '0x0000000000000000000000000000000000000000';

export function getPlayerLeaderboard(limit = 200, offset = 0) {
  return db.prepare(`
    SELECT
      addr,
      SUM(earned)    AS earned,
      SUM(ops)       AS ops,
      SUM(spent)     AS spent,
      SUM(dex_sold)  AS dex_sold,
      SUM(dex_bought)AS dex_bought,
      MAX(ts)        AS last_active
    FROM (
      SELECT to_addr   AS addr, amount AS earned, 1 AS ops, 0 AS spent, 0 AS dex_sold, 0 AS dex_bought, timestamp AS ts
        FROM transfers WHERE kind='MINT'  AND to_addr   != ?
      UNION ALL
      SELECT from_addr AS addr, 0, 0, amount AS spent, 0, 0, timestamp
        FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr NOT IN (?,?)
      UNION ALL
      SELECT from_addr AS addr, 0, 0, 0, amount AS dex_sold, 0, timestamp
        FROM transfers WHERE kind='TRANSFER' AND to_addr=? AND from_addr NOT IN (?,?)
      UNION ALL
      SELECT to_addr   AS addr, 0, 0, 0, 0, amount AS dex_bought, timestamp
        FROM transfers WHERE kind='TRANSFER' AND from_addr=? AND to_addr NOT IN (?,?)
    )
    GROUP BY addr
    ORDER BY earned DESC
    LIMIT ? OFFSET ?
  `).all(ZERO_P, ZERO_P, LP, LP, ZERO_P, LP, LP, ZERO_P, LP, limit, offset);
}

export function getPlayerStats(address) {
  const addr = address.toLowerCase();
  const row = db.prepare(`
    SELECT
      SUM(earned)    AS earned,
      SUM(ops)       AS ops,
      SUM(spent)     AS spent,
      SUM(dex_sold)  AS dex_sold,
      SUM(dex_bought)AS dex_bought,
      MAX(ts)        AS last_active,
      MIN(ts)        AS first_active
    FROM (
      SELECT amount AS earned, 1 AS ops, 0 AS spent, 0 AS dex_sold, 0 AS dex_bought, timestamp AS ts
        FROM transfers WHERE kind='MINT' AND to_addr=?
      UNION ALL
      SELECT 0, 0, amount, 0, 0, timestamp
        FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr=?
      UNION ALL
      SELECT 0, 0, 0, amount, 0, timestamp
        FROM transfers WHERE kind='TRANSFER' AND to_addr=? AND from_addr=?
      UNION ALL
      SELECT 0, 0, 0, 0, amount, timestamp
        FROM transfers WHERE kind='TRANSFER' AND from_addr=? AND to_addr=?
    )
  `).get(addr, addr, LP, addr, addr, LP);

  const vault = db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count FROM vault_payouts WHERE recipient=?`
  ).get(addr);

  // balance from holder table (fast path) or compute
  const holder = db.prepare(`SELECT balance FROM token_holders WHERE address=?`).get(addr);

  return {
    earned:      row?.earned     ?? 0,
    ops:         row?.ops        ?? 0,
    spent:       row?.spent      ?? 0,
    dex_sold:    row?.dex_sold   ?? 0,
    dex_bought:  row?.dex_bought ?? 0,
    last_active: row?.last_active ?? null,
    first_active:row?.first_active ?? null,
    vault_claimed: vault?.total ?? 0,
    vault_count:   vault?.count ?? 0,
    balance:     holder?.balance ?? 0,
  };
}

export function getPlayerActivity(address, limit = 100, offset = 0) {
  const addr = address.toLowerCase();
  return db.prepare(`
    SELECT hash, log_index, timestamp, from_addr, to_addr, amount, kind, op_type
    FROM transfers
    WHERE to_addr=? OR from_addr=?
    ORDER BY timestamp DESC, log_index DESC
    LIMIT ? OFFSET ?
  `).all(addr, addr, limit, offset);
}

export function getPlayerVaultPayouts(address, limit = 50) {
  return db.prepare(`
    SELECT hash, log_index, timestamp, amount
    FROM vault_payouts WHERE recipient=?
    ORDER BY timestamp DESC LIMIT ?
  `).all(address.toLowerCase(), limit);
}

export function getPlayerCount() {
  const row = db.prepare(
    `SELECT COUNT(DISTINCT to_addr) AS cnt FROM transfers WHERE kind='MINT' AND to_addr != ?`
  ).get(ZERO_P);
  return row?.cnt ?? 0;
}

export function getPlayerOpsBreakdown(address) {
  const addr = address.toLowerCase();
  const earned = db.prepare(`
    SELECT op_type, COUNT(*) AS cnt, ROUND(SUM(amount), 0) AS total
    FROM transfers WHERE kind='MINT' AND to_addr=?
    GROUP BY op_type ORDER BY total DESC
  `).all(addr);
  const spent = db.prepare(`
    SELECT op_type, COUNT(*) AS cnt, ROUND(SUM(amount), 0) AS total
    FROM transfers WHERE kind IN ('SPEND','BURN') AND from_addr=?
    GROUP BY op_type ORDER BY total DESC
  `).all(addr);
  const dex_sold = db.prepare(`
    SELECT COUNT(*) AS cnt, ROUND(SUM(amount), 0) AS total
    FROM transfers WHERE kind='TRANSFER' AND from_addr=? AND to_addr=?
  `).get(addr, LP);
  const dex_bought = db.prepare(`
    SELECT COUNT(*) AS cnt, ROUND(SUM(amount), 0) AS total
    FROM transfers WHERE kind='TRANSFER' AND to_addr=? AND from_addr=?
  `).get(addr, LP);
  return { earned, spent, dex_sold, dex_bought };
}

export function getPlayerInfluenceStats(address) {
  const addr = address.toLowerCase();
  const r = db.prepare(`
    SELECT
      CAST(SUM(CASE WHEN kind='MINT' THEN amount ELSE 0 END) AS INTEGER) AS total_refunded,
      CAST(SUM(CASE WHEN kind='MINT'
        AND NOT EXISTS (SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1)
        THEN amount ELSE 0 END) AS INTEGER) AS total_purchased,
      SUM(CASE WHEN kind='MINT' AND NOT EXISTS (SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1) THEN 1 ELSE 0 END) AS purchase_count,
      CAST(SUM(CASE WHEN kind='BURN' THEN amount ELSE 0 END) AS INTEGER) AS total_burned
    FROM influence_transfers WHERE to_addr=? OR from_addr=?
  `).get(addr, addr);
  return {
    totalRefunded:   r?.total_refunded   ?? 0,
    totalPurchased:  r?.total_purchased  ?? 0,
    purchaseCount:   r?.purchase_count   ?? 0,
    totalBurned:     r?.total_burned     ?? 0,
  };
}

export function getPlayerDailyHistory(address) {
  const addr = address.toLowerCase();
  return db.prepare(`
    SELECT
      DATE(timestamp, 'unixepoch') AS day,
      ROUND(SUM(CASE WHEN kind='MINT'              AND to_addr=?   THEN amount ELSE 0 END), 0) AS earned,
      ROUND(SUM(CASE WHEN kind IN ('SPEND','BURN') AND from_addr=? THEN amount ELSE 0 END), 0) AS spent,
      SUM(CASE WHEN kind='MINT' AND to_addr=? THEN 1 ELSE 0 END) AS ops
    FROM transfers
    WHERE (to_addr=? OR from_addr=?) AND kind IN ('MINT','SPEND','BURN')
    GROUP BY day ORDER BY day ASC
  `).all(addr, addr, addr, addr, addr);
}

export default db;
