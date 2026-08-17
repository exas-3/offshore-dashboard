import { NextResponse } from 'next/server';
import { getDirtyFarmers } from '../../../lib/index.js';
import { resolveAsOf } from '../../../lib/demo-clock.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(500, parseInt(searchParams.get('limit') ?? '100', 10));
    const rows = await getDirtyFarmers(limit, resolveAsOf(req));
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
