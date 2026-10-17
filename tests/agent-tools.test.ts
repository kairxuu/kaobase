import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { toolsFor, type ToolContext } from "@/lib/agents/tools";
import type { DatabaseClient } from "@/lib/database/server";

describe("les outils IA ne peuvent jamais exécuter une suppression", () => {
  it.each([
    ["finance", "supprimer_operation", "transaction", { id: "30000000-0000-0000-0000-000000000001" }],
    ["tasks", "supprimer_tache", "task", { id: "30000000-0000-0000-0000-000000000001" }],
    ["finance", "supprimer_budget", "budget", { categorie: "Alimentation" }],
  ] as const)("%s / %s prépare uniquement une confirmation ciblée", async (agent, name, kind, input) => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "request", kind, description: "Élément exact", expires_at: "2026-10-17T12:00:00Z" }], error: null });
    const from = vi.fn(() => { throw new Error("Aucun accès de suppression directe autorisé"); });
    const db = { rpc, from } as unknown as DatabaseClient;
    const ctx: ToolContext = {
      categories: [{ id: "category", name: "Alimentation", kind: "expense", color: "#000" }],
      accounts: [], space: "perso", today: "2026-10-17", written: new Set(),
      conversationId: "conversation", deletions: [],
    };
    const output = await toolsFor(agent, db, ctx)[name].execute!(input, { toolCallId: "test", messages: [], context: undefined });
    expect(output).toMatchObject({ confirmation_requise: true });
    expect(rpc).toHaveBeenCalledWith("queue_agent_deletion", expect.objectContaining({ p_kind: kind, p_space: "perso", p_conversation_id: "conversation" }));
    expect(from).not.toHaveBeenCalled();
    expect(ctx.deletions).toHaveLength(1);
  });
});
