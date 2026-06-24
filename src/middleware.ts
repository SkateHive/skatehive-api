// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticateToken } from './app/api/v1/auth';

// Public endpoints that don't require authentication
const PUBLIC_ENDPOINTS = [
  '/api/v1/leaderboard',
  '/api/v1/feed',
  '/api/v1/market',
  '/api/v1',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if the endpoint is public (allow exact match or path prefix)
  const isPublicEndpoint = PUBLIC_ENDPOINTS.some(
    (endpoint) => pathname === endpoint || pathname.startsWith(endpoint + '/')
  );

  let response: NextResponse;
  if (pathname.startsWith('/api/v1/') && !isPublicEndpoint) {
    const isAuthenticated = await authenticateToken(request);
    response = isAuthenticated
      ? NextResponse.next()
      : new NextResponse(null, { status: 401, statusText: 'Unauthorized' });
  } else {
    response = NextResponse.next();
  }

  // v1 is deprecated in favour of /api/v2 (full parity). The matcher restricts
  // this middleware to /api/v1/*, so every request here is a v1 hit: signal
  // deprecation (RFC 8594) and log usage so we can confirm there's no external
  // traffic before deleting the v1 routes. See API_ARCHITECTURE.md.
  response.headers.set('Deprecation', 'true');
  response.headers.set('Sunset', 'Sat, 01 Aug 2026 00:00:00 GMT');
  response.headers.set('Link', '</api/v2>; rel="successor-version"');
  console.warn('[v1-deprecated]', request.method, pathname);
  return response;
}


export const config = {
  matcher: ['/api/v1/:path*', '/app/api/v1/:path*'],
};
