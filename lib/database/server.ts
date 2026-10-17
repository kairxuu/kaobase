import 'server-only';
import { getAuth } from '@/lib/auth/server';
import { createNeonDataClient } from '@/lib/neon';

export async function createClient() {
  return createNeonDataClient(async () => {
    const { data, error } = await (await getAuth()).token();
    return error ? null : data?.token ?? null;
  });
}
export type DatabaseClient = Awaited<ReturnType<typeof createClient>>;
