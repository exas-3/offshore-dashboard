import { NextResponse } from 'next/server';
import { getDirtyMarketCapHistory } from '../../../lib/index.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getDirtyMarketCapHistory();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
