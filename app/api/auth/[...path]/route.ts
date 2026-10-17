import { getAuth } from '@/lib/auth/server';
import type { NextRequest } from 'next/server';
type Context = { params: Promise<{ path: string[] }> };
export async function GET(request: NextRequest, context: Context) { return (await getAuth()).handler().GET(request, context); }
export async function POST(request: NextRequest, context: Context) { return (await getAuth()).handler().POST(request, context); }
