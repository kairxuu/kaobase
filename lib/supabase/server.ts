import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { createNeonDataClient, databaseProvider } from "@/lib/neon";

// Client lié à la session de l'utilisateur : toutes les requêtes passent par la RLS.
export async function createClient() {
  const cookieStore = await cookies();
  const client = createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Appelé depuis un Server Component : le proxy rafraîchit déjà la session.
        }
      },
    },
  });
  if (databaseProvider() === "neon") {
    const database = createNeonDataClient(async () => {
      const { data, error } = await client.auth.getSession();
      if (error) return null;
      return data.session?.access_token ?? null;
    });
    // Both clients speak PostgREST. Keep every existing query and RPC on the same
    // database while authentication and password management remain with Supabase.
    client.from = database.from.bind(database);
    client.rpc = database.rpc.bind(database);
    client.schema = database.schema.bind(database);
  }
  return client;
}

export type Supabase = Awaited<ReturnType<typeof createClient>>;
