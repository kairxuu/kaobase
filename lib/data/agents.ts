import "server-only";
import type { DatabaseClient } from "@/lib/database/server";
import { UserError } from "@/lib/errors";

export type ConversationSummary = {
  id: string;
  title: string;
  agent: string;
  lastAt: string;
  messages: number;
};

// Conversations passées, reconstituées depuis agent_messages (la plus récente d'abord).
export async function listConversations(
  db: DatabaseClient,
  limit = Infinity,
): Promise<ConversationSummary[]> {
  const byId = new Map<string, ConversationSummary>();
  // User messages are sufficient for titles; avoid transferring complete assistant answers.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from("agent_messages")
      .select("conversation_id, agent, content, created_at")
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + 499);
    if (error) throw error;
    for (const m of data ?? []) {
      const id = m.conversation_id as string;
      const previous = byId.get(id);
      byId.set(id, {
        id,
        title: String(m.content).slice(0, 80),
        agent: m.agent as string,
        lastAt: previous?.lastAt ?? (m.created_at as string),
        messages: (previous?.messages ?? 0) + 1,
      });
    }
    if ((data ?? []).length < 500) break;
  }
  return [...byId.values()].slice(0, limit);
}

export type StoredMessage = {
  role: "user" | "assistant";
  content: string;
  agent: string;
  runId: string | null;
};

export async function getConversation(
  db: DatabaseClient,
  conversationId: string,
): Promise<StoredMessage[]> {
  const messages: StoredMessage[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from("agent_messages")
      .select("role, content, agent, run_id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    messages.push(
      ...(data ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string,
        agent: m.agent as string,
        runId: (m.run_id as string | null) ?? null,
      })),
    );
    if ((data ?? []).length < 500) return messages;
  }
}

export async function deleteConversation(
  db: DatabaseClient,
  conversationId: string,
) {
  const { error } = await db
    .from("agent_messages")
    .delete()
    .eq("conversation_id", conversationId);
  if (error) throw error;
}

export type MemoryItem = {
  id: string;
  agent: string;
  kind: string;
  content: string;
  createdAt: string;
  type: "memory" | "example";
};

export async function listMemories(db: DatabaseClient): Promise<MemoryItem[]> {
  const [memories, examples] = await Promise.all([
    db
      .from("agent_memories")
      .select("id, agent, kind, content, created_at")
      .neq("kind", "exchange")
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("agent_examples")
      .select("id, agent, input, output, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (memories.error) throw new Error(memories.error.message);
  if (examples.error) throw new Error(examples.error.message);
  return [
    ...(memories.data ?? []).map((m) => ({
      id: m.id as string,
      agent: m.agent as string,
      kind: m.kind as string,
      content: m.content as string,
      createdAt: m.created_at as string,
      type: "memory" as const,
    })),
    ...(examples.data ?? []).map((e) => ({
      id: e.id as string,
      agent: e.agent as string,
      kind: "example",
      content: `« ${e.input} » → ${e.output}`,
      createdAt: e.created_at as string,
      type: "example" as const,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function countExchanges(db: DatabaseClient) {
  const { count } = await db
    .from("agent_memories")
    .select("id", { count: "exact", head: true })
    .eq("kind", "exchange");
  return count ?? 0;
}

export async function deleteMemory(
  db: DatabaseClient,
  id: string,
  type: "memory" | "example",
) {
  const table = type === "memory" ? "agent_memories" : "agent_examples";
  const { data, error } = await db
    .from(table)
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new UserError("Souvenir introuvable");
}

// Efface aussi les échanges bruts mémorisés (souvenirs de type « exchange »).
export async function clearExchanges(db: DatabaseClient) {
  const { error } = await db
    .from("agent_memories")
    .delete()
    .eq("kind", "exchange");
  if (error) throw error;
}
