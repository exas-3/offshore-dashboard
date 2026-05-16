export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { ethPriceFeed } from '../../../lib/eth-price-feed.js';
import { getLatestEthPrice } from '../../../lib/db.js';

export async function GET() {
  const price = ethPriceFeed.getLatest() ?? await getLatestEthPrice().catch(() => null) ?? 0;
  return NextResponse.json({ price });
}
