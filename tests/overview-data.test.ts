import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { transactionDistributionRows } from "@/lib/data/finance";
import { getConversation, listConversations } from "@/lib/data/agents";
import type { DatabaseClient } from "@/lib/database/server";
function pagedDb(rows: unknown[], failureAt = -1) {
  const calls: { method: string; args: unknown[] }[] = [];
  const query: Record<string, unknown> = {};
  for (const method of [
    "select",
    "order",
    "eq",
    "gte",
    "lte",
    "is",
    "in",
    "or",
  ])
    query[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    };
  query.range = async (from: number, to: number) => ({
    data: rows.slice(from, to + 1),
    error: from === failureAt ? new Error("Lecture refusée") : null,
  });
  return { db: { from: () => query } as unknown as DatabaseClient, calls };
}
describe("aperçus complets et historique", () => {
  it("prend en compte toutes les pages de dépenses en respectant les filtres", async () => {
    const rows = Array.from({ length: 2101 }, () => ({
      amount: -1,
      category_id: null,
    }));
    const { db, calls } = pagedDb(rows);
    expect(
      await transactionDistributionRows(db, {
        accountIds: ["a"],
        from: "2026-10-01",
        categoryId: "c",
        search: "loyer",
      }),
    ).toHaveLength(2101);
    expect(calls).toContainEqual({ method: "in", args: ["account_id", ["a"]] });
    expect(calls).toContainEqual({
      method: "gte",
      args: ["booked_at", "2026-10-01"],
    });
    expect(
      calls
        .filter((c) => c.method === "select")
        .every((c) => c.args[0] === "category_id, amount"),
    ).toBe(true);
  });
  it("ne lit rien pour un espace sans compte", async () => {
    const { db, calls } = pagedDb([]);
    expect(await transactionDistributionRows(db, { accountIds: [] })).toEqual(
      [],
    );
    expect(calls).toEqual([]);
  });
  it("interrompt l’aperçu si une page échoue au lieu de donner un total partiel", async () => {
    const { db } = pagedDb(
      Array(1100).fill({ amount: -1, category_id: null }),
      1000,
    );
    await expect(transactionDistributionRows(db)).rejects.toThrow(
      "Lecture refusée",
    );
  });
  it("inclut les conversations au-delà de l’ancienne limite de 20", async () => {
    const rows = Array.from({ length: 503 }, (_, i) => ({
      conversation_id: String(i),
      agent: "finance",
      content: `Question ${i}`,
      created_at: "2026-10-17",
    }));
    const { db, calls } = pagedDb(rows);
    expect(await listConversations(db)).toHaveLength(503);
    expect(calls).toContainEqual({ method: "eq", args: ["role", "user"] });
  });
  it("ne tronque pas la conversation au centième message", async () => {
    const { db } = pagedDb(
      Array.from({ length: 501 }, (_, i) => ({
        role: i % 2 ? "assistant" : "user",
        content: String(i),
        agent: "finance",
        run_id: null,
      })),
    );
    const result = await getConversation(db, "conversation");
    expect(result).toHaveLength(501);
    expect(result.at(-1)?.content).toBe("500");
  });
});
