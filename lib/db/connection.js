import postgres from 'postgres';
export { ZERO_ADDR, PROTOCOL_ADDRS, DEX_POOLS } from '../chain-constants.js';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[db] DATABASE_URL not set — queries will fail');
  }
}

let _sql;
export function sql() { return _sql; }

export function getDb() {
  if (!_sql && DB_URL) {
    _sql = postgres(DB_URL, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      ssl: DB_URL.includes('localhost') || DB_URL.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
    });
  }
  return _sql;
}
