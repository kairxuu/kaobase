import { NextResponse,type NextRequest } from 'next/server';
import {getAuth} from '@/lib/auth/server';
export async function POST(request:NextRequest){
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin) return new Response(null,{status:403});
  await getAuth().signOut();
  return NextResponse.redirect(new URL('/login',request.url),{status:303});
}
