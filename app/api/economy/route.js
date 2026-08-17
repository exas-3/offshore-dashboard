import { NextResponse } from 'next/server';
import { getEconomyBuckets } from '../../../lib/index.js';
import { resolveAsOf } from '../../../lib/demo-clock.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const unit = new URL(req.url).searchParams.get('unit') === 'daily' ? 86400 : 3600;
    const data = await getEconomyBuckets(unit, resolveAsOf(req));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
