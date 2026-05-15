export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db.js';

const RPC    = 'https://mainnet.megaeth.com/rpc';
const ORACLE = '0xc555c100DB24dF36D406243642C169CC5A937f09';

let _ethPrice   = 0;
let _ethTs      = 0;
let _list       = [];   // current canonical list (top 5)
let _pool       = [];   // full pool (top 50)
let _poolTs     = 0;
const ETH_TTL  = 1_000;
const POOL_TTL = 5_000;

function liqPriceUsd(raw) {
  if (!raw || raw === '0') return 0;
  try { return Number(BigInt(raw) / 10n ** 12n) / 1e6; } catch { return 0; }
}

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr ?? '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function fetchEthPrice() {
  if (Date.now() - _ethTs < ETH_TTL) return _ethPrice;
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: ORACLE, data: '0xfeaf968c' }, 'latest'], id: 1 }),
      cache: 'no-cache',
    });
    if (res.ok) {
      const { result } = await res.json();
      const answer = BigInt('0x' + result.slice(66, 130));
      const price = Number(answer) / 1e8;
      if (isFinite(price) && price > 0) { _ethPrice = price; _ethTs = Date.now(); }
    }
  } catch {}
  return _ethPrice;
}

async function fetchPool() {
  if (Date.now() - _poolTs < POOL_TTL) return _pool;
  const db = getDb();
  const rows = await db`
    SELECT address, owner, liq_price, end_time, active
    FROM companies WHERE active = TRUE
    ORDER BY CAST(liq_price AS NUMERIC) DESC LIMIT 50
  `.catch(() => []);
  _pool = rows;
  _poolTs = Date.now();
  return _pool;
}

function buildList(pool, ethPrice) {
  const now = Math.floor(Date.now() / 1000);
  const eligible = pool
    .map(c => ({
      id:       shortAddr(c.address),
      address:  c.address,
      wallet:   c.owner || c.address,
      liqPrice: liqPriceUsd(c.liq_price),
      endTime:  c.active ? Number(c.end_time) : null,
    }))
    .map(c => ({ ...c, buffer: Math.round((ethPrice - c.liqPrice) * 100) / 100 }))
    .filter(c => c.buffer >= 0 && c.buffer < 5 && !(c.endTime > 0 && c.endTime <= now))
    .sort((a, b) => a.buffer - b.buffer);
  return { list: eligible.slice(0, 5), total: eligible.length };
}

function diff(prev, next) {
  const prevIds = prev.map(r => r.id);
  const nextIds = next.map(r => r.id);
  const events = [];
  for (const r of prev) if (!nextIds.includes(r.id)) events.push({ type: 'remove', id: r.id });
  for (const r of next) if (!prevIds.includes(r.id)) events.push({ type: 'add',    id: r.id, item: r });
  if (!events.length && JSON.stringify(prevIds) !== JSON.stringify(nextIds)) events.push({ type: 'reorder' });
  return events;
}

export async function GET() {
  const [ethPrice, pool] = await Promise.all([fetchEthPrice(), fetchPool()]);
  const { list: next, total } = buildList(pool, ethPrice);
  const events = diff(_list, next);
  _list = next;
  return NextResponse.json({ list: next, events, ethPrice, total });
}
