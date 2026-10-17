import "server-only";
import type { DatabaseClient } from "@/lib/database/server";

export async function ensureAppIdentity(client: DatabaseClient) {
  const { data, error } = await client.rpc("ensure_app_user");
  if (error) throw error;
  if (data !== true) throw new Error("Le profil n'a pas pu être initialisé.");
}
