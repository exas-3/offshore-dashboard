export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { getSupplyHistory } from '../../../lib/index.js';
import { resolveAsOf } from '../../../lib/demo-clock.js';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const hours = parseInt(searchParams.get('hours') ?? '24', 10);
    const snapshots = await getSupplyHistory(hours, resolveAsOf(req));
    return NextResponse.json({ snapshots });
  } catch (err) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
