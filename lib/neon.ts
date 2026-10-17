import 'server-only';
import { NeonPostgrestClient } from '@neondatabase/postgrest-js';

export function createNeonDataClient(accessToken: () => Promise<string | null>) {
  if (!process.env.NEON_DATA_API_URL) throw new Error('Variable manquante : NEON_DATA_API_URL');
  const url = new URL(process.env.NEON_DATA_API_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error("NEON_DATA_API_URL doit être l'adresse HTTPS du service Data API, sans identifiants.");
  }
  return new NeonPostgrestClient({ dataApiUrl: url.href.replace(/\/$/, ''), options: { global: {
    fetch: async (input, init) => {
      const token = await accessToken();
      if (!token) return Response.json({ code: 'PGRST301', message: 'Session requise.' }, { status: 401 });
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      headers.delete('apikey');
      return fetch(input, { ...init, headers, cache: 'no-store', redirect: 'error' });
    },
  } } });
}
