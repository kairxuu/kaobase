import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import type { SpaceFilter } from "@/lib/space-shared";
import type { DeletionRequest } from "./confirmation";
import { UserError } from "@/lib/errors";

export async function queueDeletion(
  supabase: Supabase,
  kind: DeletionRequest["kind"],
  targetId: string,
  conversationId: string | undefined,
  space: SpaceFilter,
): Promise<DeletionRequest> {
  if (!conversationId) throw new UserError("Ouvre une conversation pour préparer cette suppression.");
  const { data, error } = await supabase.rpc("queue_agent_deletion", {
    p_kind: kind, p_target_id: targetId, p_conversation_id: conversationId, p_space: space,
  });
  if (error) throw error;
  if (!data?.[0]) throw new UserError("Élément introuvable dans cet espace.");
  const row = data[0];
  return { id: row.id, kind: row.kind, description: row.description, expiresAt: row.expires_at };
}

export async function pendingDeletions(supabase: Supabase, conversationId: string): Promise<DeletionRequest[]> {
  const { data, error } = await supabase.from("agent_deletion_requests")
    .select("id, kind, description, expires_at").eq("conversation_id", conversationId)
    .gt("expires_at", new Date().toISOString()).order("created_at");
  // Avant la migration, les conversations restent lisibles ; les suppressions restent bloquées.
  if (error?.code === "42P01" || error?.code === "PGRST205") return [];
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, kind: r.kind, description: r.description, expiresAt: r.expires_at }));
}
