export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getTradeStates } from '../../../../server/etherscan.js';

const CORS = { 'Access-Control-Allow-Origin': '*' };

export async function GET(req) {
  const raw = new URL(req.url).searchParams.get('addrs') ?? '';
  const addrs = raw.split(',').map(a => a.trim().toLowerCase()).filter(a => /^0x[0-9a-f]{40}$/.test(a));
  if (!addrs.length) return NextResponse.json({ error: 'no valid addrs' }, { status: 400, headers: CORS });

  try {
    const companies = await getTradeStates(addrs);
    return NextResponse.json({ companies }, { headers: CORS });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500, headers: CORS });
  }
}
