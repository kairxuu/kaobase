import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import type { Category, Transaction } from "@/lib/types";
import { dedupeHash, normalizeMerchant } from "@/lib/finance/normalize";
import { applicableRule, learnFromLlm, learnFromUser, type Rule } from "@/lib/learning/rules";
import type { ParsedTransaction } from "@/lib/importers/types";
import { categorizeMerchantsWithLlm } from "@/lib/agents/categorizer";
import { runSubscriptionDetection } from "./subscriptions";

const TX_COLUMNS = "id, account_id, booked_at, amount, label_raw, merchant, category_id, categorized_by, source";

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function getCategories(supabase: Supabase): Promise<Category[]> {
  return check(await supabase.from("categories").select("id, name, kind, color").order("kind").order("name"));
}

export async function getAccounts(supabase: Supabase) {
  return check(
    await supabase.from("account_balances").select("id, name, kind, currency, balance").order("name"),
  ) as { id: string; name: string; kind: string; currency: string; balance: number }[];
}

export async function getTotalBalance(supabase: Supabase): Promise<number> {
  const accounts = await getAccounts(supabase);
  return Math.round(accounts.reduce((s, a) => s + Number(a.balance), 0) * 100) / 100;
}

export type TransactionFilters = {
  from?: string;
  to?: string;
  categoryId?: string;
  uncategorized?: boolean;
  search?: string;
  merchant?: string;
  limit?: number;
};

export async function listTransactions(supabase: Supabase, f: TransactionFilters = {}): Promise<Transaction[]> {
  let q = supabase.from("transactions").select(TX_COLUMNS).order("booked_at", { ascending: false });
  if (f.from) q = q.gte("booked_at", f.from);
  if (f.to) q = q.lte("booked_at", f.to);
  if (f.categoryId) q = q.eq("category_id", f.categoryId);
  if (f.uncategorized) q = q.is("category_id", null);
  if (f.merchant) q = q.eq("merchant", f.merchant);
  if (f.search) q = q.or(`label_raw.ilike.%${f.search.replace(/[%,()]/g, "")}%,merchant.ilike.%${f.search.replace(/[%,()]/g, "")}%`);
  const rows = check(await q.limit(f.limit ?? 200)) as Transaction[];
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export async function monthSummary(supabase: Supabase, month: string) {
  const { from, to } = monthRange(month);
  const [txs, categories] = await Promise.all([
    listTransactions(supabase, { from, to, limit: 5000 }),
    getCategories(supabase),
  ]);
  const transferIds = new Set(categories.filter((c) => c.kind === "transfer").map((c) => c.id));
  const byCategory = new Map<string, number>();
  let income = 0;
  let expenses = 0;
  for (const t of txs) {
    if (t.category_id && transferIds.has(t.category_id)) continue;
    if (t.amount > 0) income += t.amount;
    else {
      expenses += -t.amount;
      const key = t.category_id ?? "none";
      byCategory.set(key, (byCategory.get(key) ?? 0) - t.amount);
    }
  }
  const catById = new Map(categories.map((c) => [c.id, c]));
  return {
    month,
    income: Math.round(income * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    net: Math.round((income - expenses) * 100) / 100,
    count: txs.length,
    byCategory: [...byCategory.entries()]
      .map(([id, total]) => ({
        categoryId: id === "none" ? null : id,
        name: catById.get(id)?.name ?? "Non catégorisé",
        color: catById.get(id)?.color ?? "#cbd5e1",
        total: Math.round(total * 100) / 100,
      }))
      .sort((a, b) => b.total - a.total),
  };
}

// ---------------------------------------------------------------------------
// Catégorisation : règles apprises d'abord, LLM ensuite pour l'inconnu.
// ---------------------------------------------------------------------------

type RuleRow = { merchant: string; category_id: string; source: "user" | "llm"; hits: number; misses: number };

function toRule(r: RuleRow): Rule {
  return { merchant: r.merchant, categoryId: r.category_id, source: r.source, hits: r.hits, misses: r.misses };
}

async function loadRules(supabase: Supabase, merchants: string[]): Promise<Map<string, Rule>> {
  if (merchants.length === 0) return new Map();
  const rows = check(
    await supabase
      .from("categorization_rules")
      .select("merchant, category_id, source, hits, misses")
      .in("merchant", merchants),
  ) as RuleRow[];
  return new Map(rows.map((r) => [r.merchant, toRule(r)]));
}

async function saveRule(supabase: Supabase, rule: Rule) {
  check(
    await supabase.from("categorization_rules").upsert(
      {
        merchant: rule.merchant,
        category_id: rule.categoryId,
        source: rule.source,
        hits: rule.hits,
        misses: rule.misses,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,merchant" },
    ),
  );
}

// L'utilisateur choisit une catégorie : on apprend, puis on propage aux transactions
// du même marchand qu'il n'a pas catégorisées lui-même.
export async function setTransactionCategory(supabase: Supabase, transactionId: string, categoryId: string | null) {
  const tx = check(
    await supabase
      .from("transactions")
      .update({ category_id: categoryId, categorized_by: categoryId ? "user" : null })
      .eq("id", transactionId)
      .select("merchant")
      .single(),
  ) as { merchant: string };
  if (!categoryId) return { propagated: 0 };

  const existing = (await loadRules(supabase, [tx.merchant])).get(tx.merchant);
  const rule = learnFromUser(existing, tx.merchant, categoryId);
  await saveRule(supabase, rule);

  if (rule.categoryId !== categoryId) return { propagated: 0 };
  const updated = check(
    await supabase
      .from("transactions")
      .update({ category_id: categoryId, categorized_by: "rule" })
      .eq("merchant", tx.merchant)
      .neq("id", transactionId)
      .or("categorized_by.is.null,categorized_by.neq.user")
      .select("id"),
  ) as { id: string }[];
  return { propagated: updated.length };
}

export async function categorizeTransactions(
  supabase: Supabase,
  transactions: Pick<Transaction, "id" | "merchant" | "label_raw" | "amount">[],
) {
  const merchants = [...new Set(transactions.map((t) => t.merchant))];
  const rules = await loadRules(supabase, merchants);
  let byRule = 0;
  let byLlm = 0;

  const unknown = new Map<string, { merchant: string; label: string; amount: number }>();
  const assignments = new Map<string, { categoryId: string; by: "rule" | "llm"; ids: string[] }>();

  for (const t of transactions) {
    const rule = applicableRule(rules.get(t.merchant));
    if (rule) {
      const a = assignments.get(t.merchant) ?? { categoryId: rule.categoryId, by: "rule" as const, ids: [] };
      a.ids.push(t.id);
      assignments.set(t.merchant, a);
      byRule++;
    } else if (!unknown.has(t.merchant)) {
      unknown.set(t.merchant, { merchant: t.merchant, label: t.label_raw, amount: t.amount });
    }
  }

  let llmError: string | null = null;
  if (unknown.size > 0) {
    const categories = await getCategories(supabase);
    try {
      const suggestions = await categorizeMerchantsWithLlm(supabase, [...unknown.values()], categories);
      for (const [merchant, categoryId] of suggestions) {
        const rule = learnFromLlm(rules.get(merchant), merchant, categoryId);
        if (rule) await saveRule(supabase, rule);
        const ids = transactions.filter((t) => t.merchant === merchant).map((t) => t.id);
        assignments.set(merchant, { categoryId, by: "llm", ids });
        byLlm += ids.length;
      }
    } catch (error) {
      llmError = error instanceof Error ? error.message : String(error);
    }
  }

  for (const a of assignments.values()) {
    check(
      await supabase.from("transactions").update({ category_id: a.categoryId, categorized_by: a.by }).in("id", a.ids),
    );
  }

  return { byRule, byLlm, uncategorized: transactions.length - byRule - byLlm, llmError };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function importTransactions(
  supabase: Supabase,
  input: {
    accountId: string | null;
    filename: string;
    format: "csv" | "ofx";
    mapping: unknown;
    rows: ParsedTransaction[];
    invalidCount: number;
  },
) {
  const importRecord = check(
    await supabase
      .from("imports")
      .insert({
        account_id: input.accountId,
        filename: input.filename,
        format: input.format,
        mapping: input.mapping ?? null,
        rows_total: input.rows.length + input.invalidCount,
        rows_invalid: input.invalidCount,
      })
      .select("id")
      .single(),
  ) as { id: string };

  // Deux lignes strictement identiques dans un même fichier sont deux paiements réels :
  // le compteur d'occurrence les distingue, tout en restant stable d'un import à l'autre.
  const seen = new Map<string, number>();
  const records = input.rows.map((r) => {
    const key = `${r.bookedAt}|${r.amount}|${r.labelRaw.trim().toUpperCase()}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return {
      account_id: input.accountId,
      booked_at: r.bookedAt,
      amount: r.amount,
      label_raw: r.labelRaw.slice(0, 500),
      merchant: normalizeMerchant(r.labelRaw),
      source: input.format,
      import_id: importRecord.id,
      dedupe_hash: dedupeHash({ accountId: input.accountId, ...r, occurrence }),
    };
  });

  const inserted: Pick<Transaction, "id" | "merchant" | "label_raw" | "amount">[] = [];
  for (let i = 0; i < records.length; i += 500) {
    const chunk = check(
      await supabase
        .from("transactions")
        .upsert(records.slice(i, i + 500), { onConflict: "user_id,dedupe_hash", ignoreDuplicates: true })
        .select("id, merchant, label_raw, amount"),
    ) as Pick<Transaction, "id" | "merchant" | "label_raw" | "amount">[];
    inserted.push(...chunk.map((t) => ({ ...t, amount: Number(t.amount) })));
  }

  const duplicates = records.length - inserted.length;
  check(
    await supabase
      .from("imports")
      .update({ rows_imported: inserted.length, rows_duplicate: duplicates })
      .eq("id", importRecord.id),
  );

  const categorization = await categorizeTransactions(supabase, inserted);
  const detection = await runSubscriptionDetection(supabase);

  return {
    importId: importRecord.id,
    imported: inserted.length,
    duplicates,
    invalid: input.invalidCount,
    categorization,
    subscriptions: detection,
  };
}

export async function addManualTransaction(
  supabase: Supabase,
  input: { accountId: string | null; bookedAt: string; amount: number; label: string; categoryId: string | null },
) {
  const tx = check(
    await supabase
      .from("transactions")
      .insert({
        account_id: input.accountId,
        booked_at: input.bookedAt,
        amount: input.amount,
        label_raw: input.label,
        merchant: normalizeMerchant(input.label),
        source: "manual",
        dedupe_hash: dedupeHash({
          accountId: input.accountId,
          bookedAt: input.bookedAt,
          amount: input.amount,
          labelRaw: input.label,
          occurrence: Date.now(),
        }),
      })
      .select("id")
      .single(),
  ) as { id: string };
  if (input.categoryId) await setTransactionCategory(supabase, tx.id, input.categoryId);
  return tx;
}
