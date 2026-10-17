import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import { databaseProvider } from "@/lib/neon";

export async function ensureAppIdentity(client: Supabase) {
  if (databaseProvider() !== "neon") return;
  const { data, error } = await client.rpc("ensure_app_user");
  if (error) throw error;
  if (data !== true) throw new Error("Le profil n'a pas pu être initialisé.");
}
