import "server-only";
import type { DatabaseClient } from "@/lib/database/server";

export async function ensureAppIdentity(client: DatabaseClient) {
  const { data, error } = await client.rpc("ensure_app_user");
  if (error) throw error;
  if (data !== true) throw new Error("Le profil n'a pas pu être initialisé.");
  const result = await client.rpc("current_identity").single();
  if (result.error) throw result.error;
  const identity = result.data as { app_user_id?: string } | null;
  if (!identity?.app_user_id) throw new Error("Identité Neon non vérifiée.");
  return identity.app_user_id;
}
