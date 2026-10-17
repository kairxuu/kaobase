import { NextResponse, type NextRequest } from 'next/server';
import { getAuth } from '@/lib/auth/server';
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // API handlers check their session and return JSON 401 responses themselves.
  // Redirecting fetch requests here would turn an expired session into HTML 200.
  if (['/login','/auth','/api'].some(p => path === p || path.startsWith(p + '/'))) {
    return NextResponse.next({ request });
  }
  return (await getAuth()).middleware({ loginUrl: '/login' })(request);
}
