export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { reclassifyStatus, reclassifyMintTransfers } from '../../../../server/poller.js';
import { guardAdmin } from '../../../../lib/api-guard.js';

export async function GET(req) {
  const blocked = guardAdmin(req);
  if (blocked) return blocked;
  return NextResponse.json(reclassifyStatus);
}

export async function POST(req) {
  const blocked = guardAdmin(req);
  if (blocked) return blocked;
  if (reclassifyStatus.running) {
    return NextResponse.json({ ok: false, msg: 'already running', status: reclassifyStatus });
  }
  reclassifyMintTransfers(); // fire and forget
  return NextResponse.json({ ok: true, msg: 'reclassification started' });
}
