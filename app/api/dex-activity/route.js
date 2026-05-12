export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getDexActivity } from '../../../lib/index.js';

const LP = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';
function normalizeTx(t) {
  return { hash: t.hash, ts: t.timestamp, from: t.from_addr, to: t.to_addr, amount: t.amount, kind: t.kind, opType: t.op_type };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const since = parseInt(searchParams.get('since') ?? '0', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
    const rows  = (await getDexActivity(since, limit)).map(t => ({
      ...normalizeTx(t),
      wallet: t.from_addr === LP ? t.to_addr : t.from_addr,
      kind: 'SWAP',
      opType: t.to_addr === LP ? 'DEX_SELL' : 'DEX_BUY',
    }));
    return NextResponse.json({ activity: rows });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
