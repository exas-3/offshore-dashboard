import { NextResponse } from 'next/server';
import { getEconomyBuckets } from '../../../lib/index.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const unit = new URL(req.url).searchParams.get('unit') === 'daily' ? 86400 : 3600;
    const data = await getEconomyBuckets(unit);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
