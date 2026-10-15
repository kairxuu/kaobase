"use server";

import { revalidatePath } from "next/cache";
import { friendlyError, UserError } from "@/lib/errors";
import { siteOrigin } from "@/lib/site";
import { cookies } from "next/headers";
import { getSpaceFilter } from "@/lib/space";
import { defaultSpace, isSpace, parseSpaceFilter, SPACE_COOKIE, type Space, type SpaceFilter } from "@/lib/space-shared";
import { isValidTimezone } from "@/lib/time";
import { AVATAR_COLORS } from "@/lib/data/account";
import { requireUser } from "@/lib/auth";
import {
  addManualTransaction,
  categorizeTransactions,
  deleteAccount,
  deleteCategory,
  deleteTransaction,
  importTransactions,
  listTransactions,
  renameCategory,
  setTransactionCategory,
  undoImport,
  updateAccount,
  updateTransaction,
} from "@/lib/data/finance";
import {
  createSubscription,
  deleteSubscription,
  runSubscriptionDetection,
  updateSubscription,
} from "@/lib/data/subscriptions";
import { createTask, deleteTask, planSubscriptionReminders, updateTask } from "@/lib/data/tasks";
import { deleteBudget, setBudget } from "@/lib/data/budgets";
import { clearExchanges, deleteConversation, deleteMemory } from "@/lib/data/agents";
import { parseAmount, parseCsv, previewCsv, type CsvMapping } from "@/lib/importers/csv";
import { parseOfx } from "@/lib/importers/ofx";
import type { Period, SubscriptionStatus, TaskPriority, TaskStatus } from "@/lib/types";

type Result<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>, paths: string[], message?: (data: T) => string): Promise<Result<T>> {
  try {
    const data = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, data, message: message?.(data) };
  } catch (error) {
    console.error("[kaobase] action :", error);
    return { ok: false, error: friendlyError(error) };
  }
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Montant saisi à la main : « 12,50 », « 1 234.5 » ou « 12 € ».
function amountFrom(formData: FormData, field = "amount"): number {
  const value = parseAmount(String(formData.get(field) ?? ""));
  if (value == null || value === 0) throw new UserError("Montant invalide : saisis un nombre, par exemple 12,50.");
  return Math.abs(value);
}

function text(formData: FormData, field: string, label: string, max = 200): string {
  const value = String(formData.get(field) ?? "").trim();
  if (!value) throw new UserError(`${label} : ce champ est obligatoire.`);
  return value.slice(0, max);
}

// Espace d'un formulaire : le champ « space » s'il est valide, sinon l'espace actif.
async function spaceFrom(formData: FormData): Promise<Space> {
  const value = formData.get("space");
  return isSpace(value) ? value : defaultSpace(await getSpaceFilter());
}

function isoDate(formData: FormData, field: string): string | null {
  const value = String(formData.get(field) ?? "");
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new UserError("La date est invalide.");
  return value;
}

// --- Transactions ----------------------------------------------------------

export async function setCategoryAction(transactionId: string, categoryId: string | null) {
  const { supabase } = await requireUser();
  return run(() => setTransactionCategory(supabase, transactionId, categoryId), ["/transactions", "/"]);
}

export async function addTransactionAction(formData: FormData) {
  const { supabase } = await requireUser();
  const sign = formData.get("direction") === "income" ? 1 : -1;
  return run(
    async () =>
      addManualTransaction(supabase, {
        accountId: String(formData.get("accountId") || "") || null,
        bookedAt: isoDate(formData, "bookedAt") ?? new Date().toISOString().slice(0, 10),
        amount: sign * amountFrom(formData),
        label: text(formData, "label", "Libellé", 500),
        categoryId: String(formData.get("categoryId") || "") || null,
      }),
    ["/transactions", "/"],
    () => "Opération ajoutée.",
  );
}

export async function categorizeUncategorizedAction() {
  const { supabase } = await requireUser();
  return run(async () => {
    const txs = await listTransactions(supabase, { uncategorized: true, limit: 1000 });
    return categorizeTransactions(supabase, txs);
  }, ["/transactions", "/"], (r) =>
    r.llmError
      ? `${r.byRule} par règles — IA indisponible`
      : `${r.byRule} par règles, ${r.byLlm} par IA, ${r.uncategorized} restantes`,
  );
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
        amount: amountFrom(formData),
        period: (formData.get("period") as Period) || undefined,
        next_due: String(formData.get("nextDue") || "") || null,
      }),
    ["/subscriptions", "/"],
  );
}

export async function createSubscriptionAction(formData: FormData) {
  const { supabase } = await requireUser();
  return run(
    async () =>
      createSubscription(supabase, {
        name: text(formData, "name", "Nom"),
        amount: amountFrom(formData),
        period: formData.get("period") as Period,
        nextDue: isoDate(formData, "nextDue"),
        space: await spaceFrom(formData),
      }),
    ["/subscriptions", "/"],
  );
}

export async function detectSubscriptionsAction() {
  const { supabase } = await requireUser();
  return run(() => runSubscriptionDetection(supabase), ["/subscriptions", "/"], (r) => `${r.created} nouveau(x), ${r.updated} mis à jour`);
}

// --- Tâches ----------------------------------------------------------------

export async function createTaskAction(formData: FormData) {
  const { supabase } = await requireUser();
  return run(
    async () =>
      createTask(supabase, {
        title: text(formData, "title", "Titre"),
        description: String(formData.get("description") ?? "").trim() || null,
        priority: (formData.get("priority") as TaskPriority) || "medium",
        dueDate: isoDate(formData, "dueDate"),
        space: await spaceFrom(formData),
      }),
    ["/tasks", "/"],
    () => "Tâche ajoutée.",
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
  const space = await getSpaceFilter();
  return run(async () => (await planSubscriptionReminders(supabase, 7, space)).length, ["/tasks", "/"], (n) => `${n} rappel(s) créé(s)`);
}

// --- Réglages --------------------------------------------------------------

export async function updateProfileAction(formData: FormData) {
  const { supabase, userId } = await requireUser();
  return run(
    async () => {
      const currency = String(formData.get("currency") ?? "");
      const color = String(formData.get("avatarColor") ?? "");
      const timezone = String(formData.get("timezone") ?? "");
      const timezoneChanged = Boolean(timezone) && timezone !== String(formData.get("timezoneOriginal") ?? "");
      if (timezone && !isValidTimezone(timezone)) throw new UserError("Ce fuseau horaire n'est pas reconnu.");
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: String(formData.get("firstName") ?? "").trim().slice(0, 60) || null,
          currency: /^[A-Z]{3}$/.test(currency) ? currency : "EUR",
          ...(timezone ? { timezone } : {}),
        })
        .eq("id", userId);
      if (error) throw error;
      // Nom et couleur d'avatar : métadonnées Supabase Auth (aucune migration nécessaire).
      const { error: authError } = await supabase.auth.updateUser({
        data: {
          last_name: String(formData.get("lastName") ?? "").trim().slice(0, 60),
          ...((AVATAR_COLORS as readonly string[]).includes(color) ? { avatar_color: color } : {}),
          // Un fuseau choisi à la main n'est plus remplacé par la détection automatique.
          ...(timezoneChanged ? { timezone_manual: true } : {}),
        },
      });
      if (authError) throw authError;
      // La barre latérale (dans la mise en page) affiche le nom et l'avatar.
      revalidatePath("/", "layout");
    },
    ["/settings"],
    () => "Profil enregistré.",
  );
}

// Changement d'email : Supabase envoie un lien de confirmation à la nouvelle adresse.
export async function updateEmailAction(formData: FormData) {
  const { supabase, email } = await requireUser();
  return run(
    async () => {
      const next = text(formData, "email", "Email", 254).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) throw new UserError("Cette adresse email n'est pas valide.");
      if (next === email.toLowerCase()) throw new UserError("C'est déjà ton adresse actuelle.");
      const { error } = await supabase.auth.updateUser(
        { email: next },
        { emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=/settings` },
      );
      if (error) throw error;
      return next;
    },
    ["/settings"],
    (next) => `Lien de confirmation envoyé à ${next}. Ton adresse changera après le clic.`,
  );
}

export async function createAccountAction(formData: FormData) {
  const { supabase } = await requireUser();
  return run(async () => {
    const { error } = await supabase.from("accounts").insert({
      name: text(formData, "name", "Nom", 60),
      kind: String(formData.get("kind") ?? "checking"),
      opening_balance: parseAmount(String(formData.get("openingBalance") || "0")) ?? 0,
      space: await spaceFrom(formData),
    });
    if (error) throw error;
  }, ["/settings", "/"], () => "Compte ajouté.");
}

export async function createCategoryAction(formData: FormData) {
  const { supabase } = await requireUser();
  return run(async () => {
    const { error } = await supabase.from("categories").insert({
      name: String(formData.get("name") ?? "").trim(),
      kind: String(formData.get("kind") ?? "expense"),
      color: String(formData.get("color") ?? "#64748b"),
    });
    if (error?.code === "23505") throw new UserError("Cette catégorie existe déjà.");
    if (error) throw error;
  }, ["/settings", "/transactions"]);
}

// --- Gestion (revue d'ingénierie : F7, F8, F9, F11, F12, F13, F15) ---------

export async function updateTransactionAction(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  const sign = formData.get("direction") === "income" ? 1 : -1;
  return run(
    async () =>
      updateTransaction(supabase, id, {
        bookedAt: isoDate(formData, "bookedAt") ?? undefined,
        amount: sign * amountFrom(formData),
        label: text(formData, "label", "Libellé", 500),
      }),
    ["/transactions", "/"],
    () => "Opération modifiée.",
  );
}

export async function deleteTransactionAction(id: string) {
  const { supabase } = await requireUser();
  return run(() => deleteTransaction(supabase, id), ["/transactions", "/"], () => "Opération supprimée.");
}

export async function renameCategoryAction(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  return run(
    async () => renameCategory(supabase, id, { name: text(formData, "name", "Nom", 40), color: String(formData.get("color") || "") || undefined }),
    ["/settings", "/transactions", "/"],
    () => "Catégorie mise à jour.",
  );
}

export async function deleteCategoryAction(id: string) {
  const { supabase } = await requireUser();
  return run(() => deleteCategory(supabase, id), ["/settings", "/transactions", "/"], () => "Catégorie supprimée.");
}

export async function updateAccountAction(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  return run(
    async () =>
      updateAccount(supabase, id, {
        name: text(formData, "name", "Nom", 60),
        openingBalance: parseAmount(String(formData.get("openingBalance") || "0")) ?? 0,
        space: isSpace(formData.get("space")) ? (formData.get("space") as Space) : undefined,
      }),
    ["/settings", "/"],
    () => "Compte mis à jour.",
  );
}

export async function deleteAccountAction(id: string) {
  const { supabase } = await requireUser();
  return run(() => deleteAccount(supabase, id), ["/settings", "/", "/transactions"], () => "Compte supprimé.");
}

export async function setBudgetAction(formData: FormData) {
  const { supabase } = await requireUser();
  return run(
    async () => setBudget(supabase, text(formData, "categoryId", "Catégorie"), amountFrom(formData, "limit")),
    ["/settings", "/"],
    () => "Budget enregistré.",
  );
}

export async function deleteBudgetAction(categoryId: string) {
  const { supabase } = await requireUser();
  return run(() => deleteBudget(supabase, categoryId), ["/settings", "/"], () => "Budget retiré.");
}

export async function updateTaskAction(id: string, formData: FormData) {
  const { supabase } = await requireUser();
  return run(
    async () =>
      updateTask(supabase, id, {
        title: text(formData, "title", "Titre"),
        description: String(formData.get("description") ?? "").trim() || null,
        priority: (formData.get("priority") as TaskPriority) || "medium",
        due_date: isoDate(formData, "dueDate"),
      }),
    ["/tasks", "/"],
    () => "Tâche modifiée.",
  );
}

export async function deleteSubscriptionAction(id: string) {
  const { supabase } = await requireUser();
  return run(() => deleteSubscription(supabase, id), ["/subscriptions", "/"], () => "Abonnement supprimé.");
}

export async function undoImportAction(importId: string) {
  const { supabase } = await requireUser();
  return run(
    () => undoImport(supabase, importId),
    ["/import", "/transactions", "/", "/subscriptions"],
    (r) => `${r.removed} opération${r.removed > 1 ? "s" : ""} retirée${r.removed > 1 ? "s" : ""}.`,
  );
}

export async function deleteConversationAction(conversationId: string) {
  const { supabase } = await requireUser();
  return run(() => deleteConversation(supabase, conversationId), ["/agents"], () => "Conversation supprimée.");
}

export async function deleteMemoryAction(id: string, type: "memory" | "example") {
  const { supabase } = await requireUser();
  return run(() => deleteMemory(supabase, id, type), ["/agents/performance"], () => "Oublié.");
}

export async function clearExchangesAction() {
  const { supabase } = await requireUser();
  return run(() => clearExchanges(supabase), ["/agents/performance"], () => "Échanges effacés.");
}

// --- Espaces perso/pro et fuseau (ticket #1) --------------------------------

export async function setSpaceAction(filter: SpaceFilter) {
  await requireUser();
  const value = parseSpaceFilter(filter);
  (await cookies()).set(SPACE_COOKIE, value, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: false });
  revalidatePath("/", "layout");
  return { ok: true as const, data: value };
}

// Fuseau détecté par le navigateur : enregistré seulement si l'utilisateur ne l'a pas choisi à la main.
export async function syncTimezoneAction(timezone: string) {
  const { supabase, userId } = await requireUser();
  if (!isValidTimezone(timezone)) return { ok: false as const, error: "Fuseau inconnu." };
  const { data } = await supabase.auth.getUser();
  if (data.user?.user_metadata?.timezone_manual) return { ok: true as const };
  const { error } = await supabase.from("profiles").update({ timezone }).eq("id", userId);
  if (error) return { ok: false as const, error: friendlyError(error) };
  return { ok: true as const };
}
