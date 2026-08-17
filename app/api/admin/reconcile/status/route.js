export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { reconcileStatus } from '../../../../../server/poller.js';
import { guardAdmin } from '../../../../../lib/api-guard.js';

export function GET(req) {
  const blocked = guardAdmin(req);
  if (blocked) return blocked;
  return NextResponse.json(reconcileStatus);
}
