import { NextResponse, type NextRequest } from 'next/server';

/**
 * Dashboard + simulator are behind HTTP basic auth when DASHBOARD_PASSWORD is set.
 * Vaani's endpoints use their own shared secret instead (see lib/vaani.ts).
 */
const VAANI_PATHS = ['/api/qualify', '/api/call-ended', '/api/slots', '/api/book'];

export function middleware(req: NextRequest) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw || VAANI_PATHS.some((p) => req.nextUrl.pathname.startsWith(p))) return NextResponse.next();
  const header = req.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    const [, given = ''] = atob(header.slice(6)).split(/:(.*)/s);
    if (given === pw) return NextResponse.next();
  }
  return new NextResponse('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Aangan"' } });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
