import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import { UserError } from "@/lib/errors";

export type ConversationSummary = { id: string; title: string; agent: string; lastAt: string; messages: number };

// Conversations passées, reconstituées depuis agent_messages (la plus récente d'abord).
export async function listConversations(supabase: Supabase, limit = 20): Promise<ConversationSummary[]> {
  const { data, error } = await supabase
    .from("agent_messages")
    .select("conversation_id, agent, role, content, created_at")
    .order("created_at", { ascending: false })
    .limit(600);
  if (error) throw error;
  const byId = new Map<string, ConversationSummary & { firstUser?: string; firstAt: string }>();
  for (const m of data ?? []) {
    const id = m.conversation_id as string;
    const c = byId.get(id) ?? { id, title: "", agent: m.agent as string, lastAt: m.created_at as string, messages: 0, firstAt: m.created_at as string };
    c.messages++;
    // Les messages arrivent du plus récent au plus ancien : le dernier « user » vu est la première question.
    if (m.role === "user" && (m.created_at as string) <= c.firstAt) {
      c.firstUser = m.content as string;
      c.firstAt = m.created_at as string;
    }
    byId.set(id, c);
  }
  return [...byId.values()].slice(0, limit).map((c) => ({
    id: c.id,
    title: (c.firstUser ?? "Conversation").slice(0, 80),
    agent: c.agent,
    lastAt: c.lastAt,
    messages: c.messages,
  }));
}

export type StoredMessage = { role: "user" | "assistant"; content: string; agent: string; runId: string | null };

export async function getConversation(supabase: Supabase, conversationId: string): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from("agent_messages")
    .select("role, content, agent, run_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content as string,
    agent: m.agent as string,
    runId: (m.run_id as string | null) ?? null,
  }));
}

export async function deleteConversation(supabase: Supabase, conversationId: string) {
  const { error } = await supabase.from("agent_messages").delete().eq("conversation_id", conversationId);
  if (error) throw error;
}

export type MemoryItem = { id: string; agent: string; kind: string; content: string; createdAt: string; type: "memory" | "example" };

export async function listMemories(supabase: Supabase): Promise<MemoryItem[]> {
  const [memories, examples] = await Promise.all([
    supabase.from("agent_memories").select("id, agent, kind, content, created_at").neq("kind", "exchange").order("created_at", { ascending: false }).limit(100),
    supabase.from("agent_examples").select("id, agent, input, output, created_at").order("created_at", { ascending: false }).limit(50),
  ]);
  if (memories.error) throw new Error(memories.error.message);
  if (examples.error) throw new Error(examples.error.message);
  return [
    ...(memories.data ?? []).map((m) => ({
      id: m.id as string, agent: m.agent as string, kind: m.kind as string, content: m.content as string, createdAt: m.created_at as string, type: "memory" as const,
    })),
    ...(examples.data ?? []).map((e) => ({
      id: e.id as string, agent: e.agent as string, kind: "example", content: `« ${e.input} » → ${e.output}`, createdAt: e.created_at as string, type: "example" as const,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function countExchanges(supabase: Supabase) {
  const { count } = await supabase.from("agent_memories").select("id", { count: "exact", head: true }).eq("kind", "exchange");
  return count ?? 0;
}

export async function deleteMemory(supabase: Supabase, id: string, type: "memory" | "example") {
  const table = type === "memory" ? "agent_memories" : "agent_examples";
  const { data, error } = await supabase.from(table).delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new UserError("Souvenir introuvable");
}

// Efface aussi les échanges bruts mémorisés (souvenirs de type « exchange »).
export async function clearExchanges(supabase: Supabase) {
  const { error } = await supabase.from("agent_memories").delete().eq("kind", "exchange");
  if (error) throw error;
}
