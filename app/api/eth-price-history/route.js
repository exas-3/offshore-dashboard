export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getLatestEthPrice, getEthPriceHistory } from '../../../lib/index.js';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const hours = parseInt(searchParams.get('hours') ?? '24', 10);
    const [price, history] = await Promise.all([getLatestEthPrice(), getEthPriceHistory(hours)]);
    return NextResponse.json({ price, history });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
