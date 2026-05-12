export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getWalletActivity } from '../../../lib/index.js';

const LP = '0x6bd9eef21c2419feffafbf4850153a3b3a74a5e1';
function normalizeTx(t) {
  return { hash: t.hash, ts: t.timestamp, from: t.from_addr, to: t.to_addr, amount: t.amount, kind: t.kind, opType: t.op_type };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const addresses = (searchParams.get('addresses') ?? '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '200', 10), 500);
    const since = parseInt(searchParams.get('since') ?? '0', 10);
    const rows  = (await getWalletActivity(addresses, limit, since)).map(t => {
      const base   = normalizeTx(t);
      const wallet = addresses.includes(t.from_addr) ? t.from_addr : t.to_addr;
      if (t.kind === 'TRANSFER') {
        base.kind   = 'SWAP';
        base.opType = t.to_addr === LP ? 'DEX_SELL' : 'DEX_BUY';
      }
      return { ...base, wallet };
    });
    return NextResponse.json({ activity: rows });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
