export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getEthCandles, SUPPORTED_BUCKETS } from '../../../lib/eth-candles.js';

// GET /api/eth-candles?bucket=2s|5s|15s|1m
//   → { bucket, candles: [{ ts, open, high, low, close }, …] }
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const bucket = url.searchParams.get('bucket') ?? '15s';
    if (!SUPPORTED_BUCKETS.includes(bucket)) {
      return NextResponse.json({ error: 'invalid bucket', supported: SUPPORTED_BUCKETS }, { status: 400 });
    }
    return NextResponse.json({ bucket, candles: getEthCandles(bucket) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
