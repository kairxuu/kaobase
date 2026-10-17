import { NextResponse, type NextRequest } from 'next/server';
import { getAuth } from '@/lib/auth/server';
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (['/login','/auth','/api/auth/','/api/mobile/'].some(p => path === p || path.startsWith(p.endsWith('/') ? p : p + '/'))) {
    return NextResponse.next({ request });
  }
  return getAuth().middleware({ loginUrl: '/login' })(request);
}
