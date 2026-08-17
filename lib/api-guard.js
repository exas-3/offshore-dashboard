// Guards for privileged / demo-disabled API routes.
import { NextResponse } from 'next/server';
import { DEMO_MODE } from './demo-clock.js';

export function demoMode() {
  return DEMO_MODE;
}

export function checkApiKey(req) {
  const key = process.env.API_KEY;
  return !!key && req?.headers?.get?.('x-api-key') === key;
}

// Admin routes: invisible in demo mode (404), key-gated otherwise (401).
// Returns a NextResponse to send, or null when the request may proceed.
export function guardAdmin(req) {
  if (DEMO_MODE) return new NextResponse(null, { status: 404 });
  if (!checkApiKey(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return null;
}

// Live-RPC / external-upstream routes that have no historical equivalent:
// they simply don't exist in demo mode.
export function guardDemoDisabled() {
  if (DEMO_MODE) return NextResponse.json({ error: 'disabled in demo mode' }, { status: 404 });
  return null;
}
