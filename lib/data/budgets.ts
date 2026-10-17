import "server-only";
import type { DatabaseClient } from "@/lib/database/server";
import { getCategories, listTransactions, monthRange, summarizeMonth } from "./finance";
import { UserError } from "@/lib/errors";

export type BudgetStatus = {
  categoryId: string;
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  percent: number;
};

// La table budgets arrive avec la 2e migration : tant qu'elle n'est pas appliquée,
// on renvoie une liste vide au lieu de faire échouer la page ou l'agent.
function missingTable(error: { code?: string; message: string } | null) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /budgets/.test(error.message)));
}

export const BUDGETS_MISSING =
  "Les budgets sont indisponibles pour le moment. Une mise à jour de la base est nécessaire.";

export async function listBudgets(db: DatabaseClient): Promise<{ category_id: string; monthly_limit: number }[] | null> {
  const { data, error } = await db.from("budgets").select("category_id, monthly_limit");
  if (missingTable(error)) return null;
  if (error) throw error;
  return (data ?? []).map((b) => ({ category_id: b.category_id as string, monthly_limit: Number(b.monthly_limit) }));
}

export async function setBudget(db: DatabaseClient, categoryId: string, monthlyLimit: number) {
  const { error } = await db
    .from("budgets")
    .upsert(
      { category_id: categoryId, monthly_limit: monthlyLimit, updated_at: new Date().toISOString() },
      { onConflict: "user_id,category_id" },
    );
  if (missingTable(error)) throw new UserError(BUDGETS_MISSING);
  if (error) throw error;
}

export async function deleteBudget(db: DatabaseClient, categoryId: string) {
  const { error } = await db.from("budgets").delete().eq("category_id", categoryId);
  if (missingTable(error)) throw new UserError(BUDGETS_MISSING);
  if (error) throw error;
}

export async function budgetStatus(db: DatabaseClient, month: string, accountIds?: string[]): Promise<BudgetStatus[] | null> {
  const budgets = await listBudgets(db);
  if (!budgets) return null;
  if (budgets.length === 0) return [];
  const { from, to } = monthRange(month);
  const [txs, categories] = await Promise.all([listTransactions(db, { from, to, limit: 5000, accountIds }), getCategories(db)]);
  const summary = summarizeMonth(txs, categories, month);
  const spentBy = new Map(summary.byCategory.map((c) => [c.categoryId, c.total]));
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  return budgets
    .map((b) => {
      const spent = spentBy.get(b.category_id) ?? 0;
      return {
        categoryId: b.category_id,
        category: nameOf.get(b.category_id) ?? "?",
        limit: b.monthly_limit,
        spent,
        remaining: Math.round((b.monthly_limit - spent) * 100) / 100,
        percent: Math.round((spent / b.monthly_limit) * 100),
      };
    })
    .sort((a, b) => b.percent - a.percent);
}
