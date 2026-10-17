import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { createNeonDataClient, databaseProvider } from "@/lib/neon";
import { ensureAppIdentity } from "@/lib/data/identity";

/** Mobile tokens are verified by Auth, never decoded as proof of identity. */
export async function mobileSession(request: Request) {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match || match[1].length > 16384) return null;
  const token = match[1];
  const client = createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  if (databaseProvider() === "neon") {
    const database = createNeonDataClient(async () => token);
    client.from = database.from.bind(database);
    client.rpc = database.rpc.bind(database);
    client.schema = database.schema.bind(database);
  }
  await ensureAppIdentity(client);
  return { supabase: client, userId: data.user.id, email: data.user.email ?? "" };
}
