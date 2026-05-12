export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { reconcileStatus } from '../../../../../lib/index.js';

export function GET() {
  return NextResponse.json(reconcileStatus);
}
