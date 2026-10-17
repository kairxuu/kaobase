import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import type { parseAppForm } from "@/lib/apps";
import { UserError } from "@/lib/errors";

/** Non-secret references only. Nango owns and stores the OAuth credentials. */
export type AppConnection = {
  id: string;
  shortcut_id: string;
  provider_id: string;
  provider_name: string;
  integration_id: string;
  connection_id: string;
  connected_at: string;
};

export type CompleteAppConnectionInput = ReturnType<typeof parseAppForm> & {
  providerId: string;
  providerName: string;
  integrationId: string;
  connectionId: string;
};

const COLUMNS = "id, shortcut_id, provider_id, provider_name, integration_id, connection_id, connected_at";

export async function listAppConnections(supabase: Supabase): Promise<AppConnection[]> {
  const connections: AppConnection[] = [];
  const batch = 200;
  for (let start = 0; ; start += batch) {
    const { data, error } = await supabase.from("app_oauth_connections").select(COLUMNS)
      .order("connected_at", { ascending: false }).order("id").range(start, start + batch - 1);
    if (error) throw error;
    const rows = (data ?? []) as AppConnection[];
    connections.push(...rows);
    if (rows.length < batch) return connections;
  }
}

export async function getAppConnection(supabase: Supabase, id: string): Promise<AppConnection | null> {
  const { data, error } = await supabase.from("app_oauth_connections").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as AppConnection | null;
}

export async function getShortcutConnection(supabase: Supabase, shortcutId: string): Promise<AppConnection | null> {
  const { data, error } = await supabase.from("app_oauth_connections").select(COLUMNS).eq("shortcut_id", shortcutId).maybeSingle();
  if (error) throw error;
  return data as AppConnection | null;
}

/** The caller must verify this user's connection with Nango before persisting it. */
export async function completeAppConnection(supabase: Supabase, input: CompleteAppConnectionInput): Promise<string> {
  const { data, error } = await supabase.rpc("complete_app_oauth_connection", {
    p_provider_id: input.providerId,
    p_provider_name: input.providerName,
    p_integration_id: input.integrationId,
    p_connection_id: input.connectionId,
    p_name: input.name,
    p_url: input.url,
    p_account_label: input.accountLabel,
    p_category: input.category,
    p_space: input.space,
    p_pinned: input.pinned,
  });
  if (error?.code === "23505") throw new UserError("Ce raccourci est déjà associé à une autre connexion. Choisis un autre compte ou déconnecte-le d'abord.");
  if (error) throw error;
  if (typeof data !== "string" || !data) throw new UserError("La connexion n'a pas pu être enregistrée.");
  return data;
}

/** Call after Nango has confirmed deletion (or that the connection is absent). */
export async function deleteAppConnection(supabase: Supabase, id: string): Promise<void> {
  const { data, error } = await supabase.from("app_oauth_connections").delete().eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new UserError("Connexion introuvable : elle a peut-être été supprimée.");
}

export async function reserveAppConnectSession(supabase: Supabase): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { data, error } = await supabase.rpc("reserve_app_connect_session");
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : undefined;
  if (!result || typeof result.allowed !== "boolean" || !Number.isInteger(result.retry_after_seconds)
    || result.retry_after_seconds < 0 || (!result.allowed && result.retry_after_seconds < 1)) {
    throw new UserError("La limite de connexions n'a pas pu être vérifiée. Réessaie dans quelques instants.");
  }
  return { allowed: result.allowed, retryAfterSeconds: result.retry_after_seconds };
}
