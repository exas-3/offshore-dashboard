import { NextResponse } from 'next/server';

const BLOCKED_UI = /^\/(players)(\/|$)/;
const API_ROUTES = /^\/api\//;

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (BLOCKED_UI.test(pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  if (API_ROUTES.test(pathname)) {
    const envKey = process.env.API_KEY ?? '';
    if (envKey) {
      const apiKey  = request.headers.get('x-api-key') ?? '';
      const authHdr = request.headers.get('authorization') ?? '';
      const hasKey  = apiKey === envKey || authHdr === `Bearer ${envKey}`;

      if (!hasKey) {
        const referer = request.headers.get('referer') ?? '';
        const host    = request.headers.get('host')    ?? '';
        if (!referer || !referer.includes(host)) {
          return new NextResponse(null, { status: 401 });
        }
      }
    }
  }
}

export const config = {
  matcher: [
    '/players', '/players/:path*',
    '/api/:path*',
  ],
};
