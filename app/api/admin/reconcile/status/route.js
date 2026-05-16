export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { reconcileStatus } from '../../../../../server/poller.js';

export function GET() {
  return NextResponse.json(reconcileStatus);
}
