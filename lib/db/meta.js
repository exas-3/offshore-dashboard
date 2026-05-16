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
