export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { reconcileStatus, reconcileDirtyTransfers } from '../../../../server/poller.js';
import { guardAdmin } from '../../../../lib/api-guard.js';

export async function POST(req) {
  const blocked = guardAdmin(req);
  if (blocked) return blocked;
  if (reconcileStatus.running) {
    return NextResponse.json({ ok: false, msg: 'already running', status: reconcileStatus });
  }
  reconcileDirtyTransfers(); // fire and forget
  return NextResponse.json({ ok: true, msg: 'reconciliation started' });
}
