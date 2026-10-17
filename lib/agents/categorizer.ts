import "server-only";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/database/server";
import type { Category } from "@/lib/types";
import { generateWithFallback } from "@/lib/ai/provider";
import { recordRun } from "./runs";

const BATCH = 60;

const responseSchema = z.object({
  items: z.array(z.object({ merchant: z.string(), category: z.string() })),
});

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Réponse IA sans JSON");
  return JSON.parse(text.slice(start, end + 1));
}

// Catégorise par lots les marchands qu'aucune règle ne connaît encore.
// Les réponses deviennent des règles « llm » (confiance 0.5) que l'utilisateur confirme ou corrige.
export async function categorizeMerchantsWithLlm(
  db: DatabaseClient,
  merchants: { merchant: string; label: string; amount: number }[],
  categories: Category[],
): Promise<Map<string, string>> {
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const result = new Map<string, string>();
  const categoryList = categories.map((c) => `- ${c.name} (${c.kind === "income" ? "revenu" : c.kind === "transfer" ? "virement interne" : "dépense"})`).join("\n");

  for (let i = 0; i < merchants.length; i += BATCH) {
    const batch = merchants.slice(i, i + BATCH);
    const started = Date.now();
    const input = batch
      .map((m) => `${m.merchant} | ${m.label} | ${m.amount > 0 ? "crédit" : "débit"} ${Math.abs(m.amount).toFixed(2)}`)
      .join("\n");
    try {
      const { result: res, provider, model } = await generateWithFallback({
        system:
          "Tu es l'agent Finance de KAOBASE. Tu classes des opérations bancaires françaises.\n" +
          "Catégories autorisées (utilise exactement ces noms) :\n" + categoryList + "\n" +
          'Réponds UNIQUEMENT avec un JSON : {"items":[{"merchant":"...","category":"..."}]}. ' +
          "Si tu hésites vraiment, utilise « Divers » pour une dépense et « Autres revenus » pour un crédit.",
        messages: [{ role: "user", content: `Marchand | libellé brut | sens montant\n${input}` }],
      });
      const parsed = responseSchema.parse(extractJson(res.text));
      for (const item of parsed.items) {
        const id = byName.get(item.category.toLowerCase().trim());
        if (id && batch.some((m) => m.merchant === item.merchant)) result.set(item.merchant, id);
      }
      await recordRun(db, {
        agent: "finance",
        provider,
        model,
        input: `[auto] Catégorisation de ${batch.length} marchands`,
        output: `${parsed.items.length} réponses, ${result.size} catégories valides`,
        latencyMs: Date.now() - started,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
      });
    } catch (error) {
      await recordRun(db, {
        agent: "finance",
        input: `[auto] Catégorisation de ${batch.length} marchands`,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  return result;
}
