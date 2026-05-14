import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const env = readFileSync(resolve('/home/work/offshore-dashboard', '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
} catch {}
try {
  const env = readFileSync(resolve('/home/work/offshore-dashboard', '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
} catch {}

const { syncLiquidationsFromIdx, setLastLiqBlock, getDb } = await import('../lib/index.js');

// Get the head block from idx_state
const db = getDb();
const [head] = await db`SELECT value::int AS v FROM idx_state WHERE key='head'`.catch(() => [null]);
if (!head) { console.error('idx_state head not found'); process.exit(1); }

console.log(`Backfilling liquidations from block 0 to ${head.v}...`);
const inserted = await syncLiquidationsFromIdx(0, head.v);
await setLastLiqBlock(head.v);
console.log(`Done — inserted ${inserted} FAIL records`);
process.exit(0);
