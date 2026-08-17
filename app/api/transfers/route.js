export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getRecentTransfers } from '../../../lib/index.js';
import { resolveAsOf } from '../../../lib/demo-clock.js';

function normalizeTx(t) {
  return { hash: t.hash, log_index: t.log_index, ts: t.timestamp, from: t.from_addr, to: t.to_addr, amount: t.amount, kind: t.kind, opType: t.op_type };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '100', 10), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0',   10), 0);
    const rows   = (await getRecentTransfers(limit, offset, resolveAsOf(req))).map(normalizeTx);
    return NextResponse.json({ transfers: rows, limit, offset });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
