"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  addManualTransaction,
  categorizeTransactions,
  importTransactions,
  listTransactions,
  setTransactionCategory,
} from "@/lib/data/finance";
import {
  createSubscription,
  runSubscriptionDetection,
  updateSubscription,
} from "@/lib/data/subscriptions";
import { createTask, deleteTask, planSubscriptionReminders, updateTask } from "@/lib/data/tasks";
import { parseCsv, previewCsv, type CsvMapping } from "@/lib/importers/csv";
import { parseOfx } from "@/lib/importers/ofx";
import type { Period, SubscriptionStatus, TaskPriority, TaskStatus } from "@/lib/types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>, paths: string[]): Promise<Result<T>> {
  try {
    const data = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Erreur inconnue" };
  }
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

// --- Transactions ----------------------------------------------------------

export async function setCategoryAction(transactionId: string, categoryId: string | null) {
  const { supabase } = await requireUser();
  return run(() => setTransactionCategory(supabase, transactionId, categoryId), ["/transactions", "/"]);
}

export async function addTransactionAction(formData: FormData) {
  const { supabase } = await requireUser();
  const amount = Number(String(formData.get("amount")).replace(",", "."));
  const sign = formData.get("direction") === "income" ? 1 : -1;
  return run(
    () =>
      addManualTransaction(supabase, {
        accountId: String(formData.get("accountId") || "") || null,
        bookedAt: String(formData.get("bookedAt")),
        amount: sign * Math.abs(amount),
        label: String(formData.get("label") ?? "").trim(),
        categoryId: String(formData.get("categoryId") || "") || null,
      }),
    ["/transactions", "/"],
  );
}

export async function categorizeUncategorizedAction() {
  const { supabase } = await requireUser();
  return run(async () => {
    const txs = await listTransactions(supabase, { uncategorized: true, limit: 1000 });
    return categorizeTransactions(supabase, txs);
  }, ["/transactions", "/"]);
}

// --- Import ----------------------------------------------------------------

export async function previewCsvAction(text: string) {
  await requireUser();
  if (text.length > MAX_FILE_BYTES) return { ok: false as const, error: "Fichier trop volumineux (5 Mo max)." };
  return { ok: true as const, data: previewCsv(text) };
}

export async function importFileAction(input: {
  text: string;
  filename: string;
  format: "csv" | "ofx";
  mapping?: CsvMapping;
  accountId: string | null;
}) {
  const { supabase } = await requireUser();
  if (input.text.length > MAX_FILE_BYTES) return { ok: false as const, error: "Fichier trop volumineux (5 Mo max)." };
  const parsed = input.format === "ofx" ? parseOfx(input.text) : input.mapping ? parseCsv(input.text, input.mapping) : null;
  if (!parsed) return { ok: false as const, error: "Mapping des colonnes manquant." };
  if (parsed.rows.length === 0) return { ok: false as const, error: "Aucune ligne exploitable dans ce fichier." };
  return run(
    () =>
      importTransactions(supabase, {
        accountId: input.accountId,
        filename: input.filename.slice(0, 200),
        format: input.format,
        mapping: input.mapping,
        rows: parsed.rows,
        invalidCount: parsed.invalid.length,
      }),
    ["/", "/transactions", "/subscriptions", "/import"],
  );
}

// --- Abonnements -----------------------------------------------------------

export async function setSubscriptionStatusAction(id: string, status: SubscriptionStatus) {
  const { supabase } = await requireUser();
  return run(() => updateSubscription(supabase, id, { status }), ["/subscriptions", "/"]);
}

export async function updateSubscriptionAction(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  return run(
    () =>
      updateSubscription(supabase, id, {
        name: String(formData.get("name") ?? "").trim() || undefined,
        amount: Number(String(formData.get("amount")).replace(",", ".")) || undefined,
        period: (formData.get("period") as Period) || undefined,
        next_due: String(formData.get("nextDue") || "") || null,
      }),
    ["/subscriptions", "/"],
  );
}

export async function createSubscriptionAction(formData: FormData) {
  const { supabase } = await requireUser();
  return run(
    () =>
      createSubscription(supabase, {
        name: String(formData.get("name") ?? "").trim(),
        amount: Number(String(formData.get("amount")).replace(",", ".")),
        period: formData.get("period") as Period,
        nextDue: String(formData.get("nextDue") || "") || null,
      }),
    ["/subscriptions", "/"],
  );
}

export async function detectSubscriptionsAction() {
  const { supabase } = await requireUser();
  return run(() => runSubscriptionDetection(supabase), ["/subscriptions", "/"]);
}

// --- Tâches ----------------------------------------------------------------

export async function createTaskAction(formData: FormData) {
  const { supabase } = await requireUser();
  return run(
    () =>
      createTask(supabase, {
        title: String(formData.get("title") ?? "").trim(),
        description: String(formData.get("description") ?? "").trim() || null,
        priority: (formData.get("priority") as TaskPriority) || "medium",
        dueDate: String(formData.get("dueDate") || "") || null,
      }),
    ["/tasks", "/"],
  );
}

export async function setTaskStatusAction(id: string, status: TaskStatus) {
  const { supabase } = await requireUser();
  return run(() => updateTask(supabase, id, { status }), ["/tasks", "/"]);
}

export async function deleteTaskAction(id: string) {
  const { supabase } = await requireUser();
  return run(() => deleteTask(supabase, id), ["/tasks", "/"]);
}

export async function planRemindersAction() {
  const { supabase } = await requireUser();
  return run(async () => (await planSubscriptionReminders(supabase, 7)).length, ["/tasks", "/"]);
}

// --- Réglages --------------------------------------------------------------

export async function updateProfileAction(formData: FormData) {
  const { supabase, userId } = await requireUser();
  return run(async () => {
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: String(formData.get("displayName") ?? "").trim() || null,
        currency: String(formData.get("currency") ?? "EUR").toUpperCase().slice(0, 3),
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);
  }, ["/settings"]);
}

export async function createAccountAction(formData: FormData) {
  const { supabase } = await requireUser();
  return run(async () => {
    const { error } = await supabase.from("accounts").insert({
      name: String(formData.get("name") ?? "").trim(),
      kind: String(formData.get("kind") ?? "checking"),
      opening_balance: Number(String(formData.get("openingBalance") || "0").replace(",", ".")),
    });
    if (error) throw new Error(error.message);
  }, ["/settings", "/"]);
}

export async function createCategoryAction(formData: FormData) {
  const { supabase } = await requireUser();
  return run(async () => {
    const { error } = await supabase.from("categories").insert({
      name: String(formData.get("name") ?? "").trim(),
      kind: String(formData.get("kind") ?? "expense"),
      color: String(formData.get("color") ?? "#64748b"),
    });
    if (error) throw new Error(error.code === "23505" ? "Cette catégorie existe déjà." : error.message);
  }, ["/settings", "/transactions"]);
}
