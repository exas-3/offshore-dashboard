import { NextResponse } from 'next/server';

const BLOCKED_UI   = /^\/(players)(\/|$)/;
const RESTRICTED   = /^\/(api\/players|api\/monitor)(\/|$)/;

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (BLOCKED_UI.test(pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  if (RESTRICTED.test(pathname)) {
    const referer = request.headers.get('referer') ?? '';
    const host    = request.headers.get('host')    ?? '';
    if (!referer || !referer.includes(host)) {
      return new NextResponse(null, { status: 403 });
    }
  }
}

export const config = {
  matcher: [
    '/players', '/players/:path*',
    '/api/players', '/api/players/:path*',
    '/api/monitor',
  ],
};
