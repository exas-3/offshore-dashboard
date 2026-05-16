export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { reconcileStatus, reconcileDirtyTransfers } from '../../../../server/poller.js';

export async function POST() {
  if (reconcileStatus.running) {
    return NextResponse.json({ ok: false, msg: 'already running', status: reconcileStatus });
  }
  reconcileDirtyTransfers(); // fire and forget
  return NextResponse.json({ ok: true, msg: 'reconciliation started' });
}
