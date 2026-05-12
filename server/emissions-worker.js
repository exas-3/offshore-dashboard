import { parentPort, workerData } from 'worker_threads';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? join(__dirname, '..', 'offshore.db');

// Read-only connection — worker only reads, main thread writes
const db = new Database(DB_PATH, { readonly: true });
db.pragma('cache_size = -32768');  // 32 MB — conservative for worker thread
db.pragma('mmap_size = 67108864'); // 64 MB mmap

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const PROTOCOL_ADDRS = ['0x5dc36d6dcd5a3792b3980de1f40c7c0970af3462'];
const NOT_PROTOCOL_MINT = `NOT (kind='MINT' AND to_addr IN (${PROTOCOL_ADDRS.map(() => '?').join(',')}))`;
const LP = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';

function bucketLabels(startTs, numSlots, unit) {
  return Array.from({ length: numSlots }, (_, i) => {
    const ts = new Date((startTs + i * unit) * 1000);
    return unit === 3600
      ? `${ts.getMonth() + 1}/${ts.getDate()} ${String(ts.getHours()).padStart(2, '0')}h`
      : `${ts.getMonth() + 1}/${ts.getDate()}`;
  });
}

function _emissionBuckets(unit) {
  const first = db.prepare(`SELECT MIN(timestamp) AS ts FROM transfers WHERE kind IN ('MINT','SPEND','BURN') AND ${NOT_PROTOCOL_MINT}`).get(...PROTOCOL_ADDRS);
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : first.ts;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = db.prepare(`
    SELECT CAST((timestamp-?)/${unit} AS INTEGER) AS slot,
      COUNT(*) AS mints,
      CAST(SUM(amount) AS INTEGER) AS dirty
    FROM transfers WHERE kind='MINT' AND ${NOT_PROTOCOL_MINT}
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs, ...PROTOCOL_ADDRS);
  const map = new Map(rows.map(r => [r.slot, r]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => ({ label, mints: map.get(i)?.mints ?? 0, dirty: map.get(i)?.dirty ?? 0 }));
}

function _burnBuckets(unit) {
  const first = db.prepare(`SELECT MIN(timestamp) AS ts FROM transfers WHERE kind IN ('SPEND','BURN')`).get();
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : first.ts;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = db.prepare(`
    SELECT CAST((timestamp-?)/${unit} AS INTEGER) AS slot,
      CAST(SUM(CASE WHEN op_type='BURN'             THEN amount ELSE 0 END) AS INTEGER) AS burned,
      CAST(SUM(CASE WHEN op_type='BUY_ASSET'        THEN amount ELSE 0 END) AS INTEGER) AS assets,
      CAST(SUM(CASE WHEN op_type='LEVEL_UP'         THEN amount ELSE 0 END) AS INTEGER) AS levels,
      CAST(SUM(CASE WHEN op_type='THIRD_ENTERPRISE' THEN amount ELSE 0 END) AS INTEGER) AS enterprise
    FROM transfers WHERE kind IN ('SPEND','BURN')
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs);
  const map = new Map(rows.map(r => [r.slot, r]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => {
    const r = map.get(i);
    return { label, burned: r?.burned ?? 0, assets: r?.assets ?? 0, levels: r?.levels ?? 0, enterprise: r?.enterprise ?? 0 };
  });
}

function _flowBuckets(unit) {
  const first = db.prepare(`SELECT MIN(timestamp) AS ts FROM transfers WHERE kind IN ('MINT','SPEND','BURN')`).get();
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : first.ts;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = db.prepare(`
    SELECT CAST((timestamp-?)/${unit} AS INTEGER) AS slot,
      CAST(SUM(CASE WHEN kind='MINT' AND ${NOT_PROTOCOL_MINT} THEN amount ELSE 0 END) AS INTEGER) AS minted,
      CAST(SUM(CASE WHEN kind IN ('SPEND','BURN') THEN amount ELSE 0 END) AS INTEGER) AS spent,
      CAST(SUM(CASE WHEN kind='MINT' AND NOT (${NOT_PROTOCOL_MINT}) THEN amount ELSE 0 END) AS INTEGER) AS protocol_mint
    FROM transfers WHERE kind IN ('MINT','SPEND','BURN')
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs, ...PROTOCOL_ADDRS, ...PROTOCOL_ADDRS);
  const map = new Map(rows.map(r => [r.slot, r]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => {
    const r = map.get(i);
    const minted = r?.minted ?? 0, spent = r?.spent ?? 0, protocolMint = r?.protocol_mint ?? 0;
    return { label, minted, spent, net: minted - spent, protocolMint };
  });
}

function _supplyHistory(unit) {
  const rows = db.prepare(`
    SELECT supply FROM (
      SELECT timestamp, supply,
        ROW_NUMBER() OVER (
          PARTITION BY ${unit === 86400 ? "DATE(timestamp,'unixepoch')" : "STRFTIME('%Y-%m-%d %H',timestamp,'unixepoch')"}
          ORDER BY timestamp DESC
        ) AS rn
      FROM supply_snapshots
    ) WHERE rn=1 ORDER BY timestamp ASC
  `).all();
  return rows.map((r, i) => {
    const snap = db.prepare(`SELECT timestamp FROM supply_snapshots ORDER BY timestamp ASC LIMIT 1 OFFSET ?`).get(i);
    return r;
  });
}

function getSupplyHistory(unit) {
  const label_fmt = unit === 86400
    ? "CAST(STRFTIME('%m',timestamp,'unixepoch') AS INTEGER)||'/'||CAST(STRFTIME('%d',timestamp,'unixepoch') AS INTEGER)"
    : "STRFTIME('%m/%d %Hh',timestamp,'unixepoch')";
  const part = unit === 86400 ? "DATE(timestamp,'unixepoch')" : "STRFTIME('%Y-%m-%d %H',timestamp,'unixepoch')";
  return db.prepare(`
    SELECT ${label_fmt} AS label, supply
    FROM (SELECT timestamp, supply, ROW_NUMBER() OVER (PARTITION BY ${part} ORDER BY timestamp DESC) AS rn FROM supply_snapshots)
    WHERE rn=1 ORDER BY timestamp ASC
  `).all();
}

function _influenceBuckets(unit) {
  const first = db.prepare(`SELECT MIN(timestamp) AS ts FROM influence_transfers WHERE kind IN ('MINT','BURN') AND timestamp>0`).get();
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : first.ts;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = db.prepare(`
    SELECT CAST((timestamp-?)/${unit} AS INTEGER) AS slot,
      CAST(SUM(CASE WHEN kind='MINT' THEN amount ELSE 0 END) AS INTEGER) AS minted,
      CAST(SUM(CASE WHEN kind='BURN' THEN amount ELSE 0 END) AS INTEGER) AS burned,
      CAST(SUM(CASE WHEN kind='MINT'
        AND NOT EXISTS (SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1)
        THEN amount ELSE 0 END) AS INTEGER) AS purchased
    FROM influence_transfers WHERE kind IN ('MINT','BURN') AND timestamp>0
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs);
  const map = new Map(rows.map(r => [r.slot, r]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => ({ label, minted: map.get(i)?.minted ?? 0, burned: map.get(i)?.burned ?? 0, purchased: map.get(i)?.purchased ?? 0 }));
}

function getInfluenceStats() {
  const r = db.prepare(`
    SELECT
      CAST(SUM(CASE WHEN kind='MINT' THEN amount ELSE 0 END) AS INTEGER) AS total_minted,
      CAST(SUM(CASE WHEN kind='BURN' THEN amount ELSE 0 END) AS INTEGER) AS total_burned,
      COUNT(DISTINCT CASE WHEN kind='MINT' THEN to_addr END) AS unique_earners,
      CAST(SUM(CASE WHEN kind='MINT' AND EXISTS(SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1) THEN amount ELSE 0 END) AS INTEGER) AS total_refunded,
      CAST(SUM(CASE WHEN kind='MINT' AND NOT EXISTS(SELECT 1 FROM transfers d WHERE d.hash=influence_transfers.hash LIMIT 1) THEN amount ELSE 0 END) AS INTEGER) AS total_purchased
    FROM influence_transfers WHERE timestamp>0
  `).get();
  const inf = db.prepare(`SELECT supply FROM influence_supply_snapshots ORDER BY timestamp DESC LIMIT 1`).get();
  return {
    totalMinted: r.total_minted ?? 0, totalBurned: r.total_burned ?? 0,
    totalRefunded: r.total_refunded ?? 0, totalPurchased: r.total_purchased ?? 0,
    circulating: inf?.supply ?? null, uniqueEarners: r.unique_earners ?? 0,
  };
}

function _participantBuckets(unit) {
  const first = db.prepare(`SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT' AND to_addr!=?`).get(ZERO_ADDR);
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : first.ts;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = db.prepare(`
    SELECT slot, COUNT(*) AS new_wallets FROM (
      SELECT CAST((MIN(timestamp)-?)/${unit} AS INTEGER) AS slot
      FROM transfers WHERE kind='MINT' AND to_addr!=? GROUP BY to_addr
    ) GROUP BY slot ORDER BY slot ASC
  `).all(startTs, ZERO_ADDR);
  const map = new Map(rows.map(r => [r.slot, r.new_wallets]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => ({ label, newWallets: map.get(i) ?? 0 }));
}

function _activeWalletBuckets(unit) {
  const first = db.prepare(`SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT' AND to_addr!=?`).get(ZERO_ADDR);
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : first.ts;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = db.prepare(`
    SELECT CAST((timestamp-?)/${unit} AS INTEGER) AS slot,
      COUNT(DISTINCT CASE WHEN kind='MINT' THEN to_addr END) AS active
    FROM transfers WHERE kind IN ('MINT') AND to_addr!=? AND ${NOT_PROTOCOL_MINT}
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs, ZERO_ADDR, ...PROTOCOL_ADDRS);
  const map = new Map(rows.map(r => [r.slot, r.active]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => ({ label, activeWallets: map.get(i) ?? 0 }));
}

function _opBreakdown(unit) {
  const first = db.prepare(`SELECT MIN(timestamp) AS ts FROM transfers WHERE kind='MINT' AND ${NOT_PROTOCOL_MINT}`).get(...PROTOCOL_ADDRS);
  if (!first?.ts) return [];
  const startTs  = unit === 86400 ? Math.floor(first.ts / 86400) * 86400 : first.ts;
  const numSlots = Math.floor((Date.now() / 1000 - startTs) / unit) + 1;
  const rows = db.prepare(`
    SELECT CAST((timestamp-?)/${unit} AS INTEGER) AS slot,
      SUM(CASE WHEN op_type='EXTORTION' THEN 1 ELSE 0 END) AS extortion,
      SUM(CASE WHEN op_type='ARMS_DEAL' THEN 1 ELSE 0 END) AS armsDeal,
      SUM(CASE WHEN op_type='DRUG_DEAL' THEN 1 ELSE 0 END) AS drugDeal,
      SUM(CASE WHEN op_type='PARTIAL'   THEN 1 ELSE 0 END) AS partial,
      CAST(SUM(CASE WHEN op_type='EXTORTION' THEN amount ELSE 0 END) AS INTEGER) AS extortionDirty,
      CAST(SUM(CASE WHEN op_type='ARMS_DEAL' THEN amount ELSE 0 END) AS INTEGER) AS armsDealDirty,
      CAST(SUM(CASE WHEN op_type='DRUG_DEAL' THEN amount ELSE 0 END) AS INTEGER) AS drugDealDirty,
      CAST(SUM(CASE WHEN op_type='PARTIAL'   THEN amount ELSE 0 END) AS INTEGER) AS partialDirty
    FROM transfers WHERE kind='MINT' AND ${NOT_PROTOCOL_MINT}
    GROUP BY slot ORDER BY slot ASC
  `).all(startTs, ...PROTOCOL_ADDRS);
  const map = new Map(rows.map(r => [r.slot, r]));
  const labels = bucketLabels(startTs, numSlots, unit);
  return labels.map((label, i) => {
    const r = map.get(i) ?? {};
    return { label, extortion: r.extortion??0, armsDeal: r.armsDeal??0, drugDeal: r.drugDeal??0, partial: r.partial??0,
             extortionDirty: r.extortionDirty??0, armsDealDirty: r.armsDealDirty??0, drugDealDirty: r.drugDealDirty??0, partialDirty: r.partialDirty??0 };
  });
}

function compute() {
  return {
    dailyBuckets:       _emissionBuckets(86400),
    hourlyBuckets:      _emissionBuckets(3600),
    dailyBurnBuckets:   _burnBuckets(86400),
    hourlyBurnBuckets:  _burnBuckets(3600),
    dailyFlowBuckets:   _flowBuckets(86400),
    hourlyFlowBuckets:  _flowBuckets(3600),
    dailySupply:        getSupplyHistory(86400),
    hourlySupply:       getSupplyHistory(3600),
    dailyInfluence:     _influenceBuckets(86400),
    hourlyInfluence:    _influenceBuckets(3600),
    influenceStats:     getInfluenceStats(),
    dailyParticipants:  _participantBuckets(86400),
    hourlyParticipants: _participantBuckets(3600),
    dailyActiveWallets: _activeWalletBuckets(86400),
    hourlyActiveWallets:_activeWalletBuckets(3600),
    dailyOpBreakdown:   _opBreakdown(86400),
    hourlyOpBreakdown:  _opBreakdown(3600),
  };
}

parentPort.on('message', (msg) => {
  if (msg === 'compute') {
    try {
      parentPort.postMessage({ ok: true, data: compute() });
    } catch (err) {
      parentPort.postMessage({ ok: false, error: err.message });
    }
  }
});
