import { getDb } from './connection.js';
const db = () => getDb();

export async function getLastBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}

export async function getLastInfluenceBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_influence_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastInfluenceBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_influence_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}

export async function getLastVaultBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_vault_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastVaultBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_vault_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}

export async function getLastLiqBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_liq_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastLiqBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_liq_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}

// Cursor for the lightweight TradeStarted-event sweep (syncCompanyStarts).
export async function getLastTradeStartBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_trade_start_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastTradeStartBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_trade_start_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}

// Cursor for the PARTIAL-recovery sweep (syncs/partial-sweep.js).
export async function getLastPartialSweepBlock() {
  const [row] = await db()`SELECT value FROM meta WHERE key = 'last_partial_sweep_block'`;
  return row ? parseInt(row.value, 10) : 0;
}
export async function setLastPartialSweepBlock(n) {
  await db()`INSERT INTO meta(key,value) VALUES('last_partial_sweep_block',${String(n)})
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
}
