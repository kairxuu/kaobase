import 'server-only';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createNeonDataClient } from '@/lib/neon';
import { ensureAppIdentity } from '@/lib/data/identity';
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksUrl: string | undefined;
export async function verifyMobileToken(token: string) {
  const base = process.env.NEON_AUTH_BASE_URL;
  if (!base) throw new Error('NEON_AUTH_BASE_URL manquante.');
  const url = process.env.NEON_AUTH_JWKS_URL ?? `${base}/.well-known/jwks.json`;
  if (!jwks || jwksUrl !== url) { jwks = createRemoteJWKSet(new URL(url)); jwksUrl = url; }
  try {
    const origin = new URL(base).origin;
    const { payload } = await jwtVerify(token, jwks, { issuer: origin, audience: origin, algorithms: ['EdDSA'] });
    if (!payload.sub || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) return null;
    return payload;
  } catch { return null; }
}
export async function mobileSession(request: Request) {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match || match[1].length > 16384) return null;
  const claims = await verifyMobileToken(match[1]);
  if (!claims) return null;
  const db = createNeonDataClient(async () => match[1]);
  await ensureAppIdentity(db);
  return { db, userId: claims.sub!, email: typeof claims.email === 'string' ? claims.email : '' };
}
