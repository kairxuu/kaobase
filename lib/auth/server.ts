import 'server-only';
import { createNeonAuth } from '@neondatabase/auth/next/server';

let instance: ReturnType<typeof createNeonAuth> | undefined;
export function getAuth() {
  if (!instance) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret) throw new Error('Configure NEON_AUTH_BASE_URL et NEON_AUTH_COOKIE_SECRET.');
    instance = createNeonAuth({ baseUrl, cookies: { secret }, logLevel: 'silent' });
  }
  return instance;
}
