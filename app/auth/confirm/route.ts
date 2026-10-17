import { NextResponse, type NextRequest } from 'next/server';
// Old email links cannot establish a Neon session. Request a fresh code instead.
export async function GET(request:NextRequest){ return NextResponse.redirect(new URL('/login?lien=expire',request.url)); }
