export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { reclassifyStatus, reclassifyMintTransfers } from '../../../../server/poller.js';

export async function GET() {
  return NextResponse.json(reclassifyStatus);
}

export async function POST() {
  if (reclassifyStatus.running) {
    return NextResponse.json({ ok: false, msg: 'already running', status: reclassifyStatus });
  }
  reclassifyMintTransfers(); // fire and forget
  return NextResponse.json({ ok: true, msg: 'reclassification started' });
}
