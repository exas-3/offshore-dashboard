import { NextResponse } from 'next/server';

const BLOCKED = /^\/(players|api\/players)(\/|$)/;

export function middleware(request) {
  if (BLOCKED.test(request.nextUrl.pathname)) {
    return new NextResponse(null, { status: 404 });
  }
}

export const config = {
  matcher: ['/players', '/players/:path*', '/api/players', '/api/players/:path*'],
};
