import { NextResponse } from 'next/server';
import { getDirtyMarketCapHistory } from '../../../lib/index.js';
import { resolveAsOf } from '../../../lib/demo-clock.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const data = await getDirtyMarketCapHistory(resolveAsOf(req));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
