import { z } from "zod";
import { revalidatePath } from "next/cache";
import { mobileSession } from "@/lib/mobile/auth";
import * as v from "@/lib/mobile/validation";
import { UserError, friendlyError } from "@/lib/errors";
import { completeSetup, getOnboardingStatus } from "@/lib/data/onboarding";
import { getAccounts, getCategories, listTransactions, monthSummary, addManualTransaction, deleteTransaction, setTransactionCategory, createAccount } from "@/lib/data/finance";
import { listSubscriptions, createSubscription, updateSubscription, deleteSubscription } from "@/lib/data/subscriptions";
import { listTasks, createTask, updateTask, deleteTask } from "@/lib/data/tasks";
import { listAppShortcuts, createAppShortcut, pinAppShortcut, deleteAppShortcut } from "@/lib/data/apps";
import { listAppConnections, getShortcutConnection } from "@/lib/data/app-connections";
import { budgetStatus, setBudget, deleteBudget } from "@/lib/data/budgets";
import { parseAppForm } from "@/lib/apps";
import { getAppCatalog } from "@/lib/integrations/app-catalog";
import { askAgent } from "@/lib/agents/orchestrator";
import { checkUserLimit, LimitUnavailableError } from "@/lib/agents/limits";

export const maxDuration = 60;
type Context = { params: Promise<{ path: string[] }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" } });

async function body(request: Request): Promise<unknown> {
  // Bound the stream even when Content-Length is absent or forged.
  const reader = request.body?.getReader();
  if (!reader) throw new UserError("Requête vide.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); throw new UserError("Requête trop volumineuse."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new UserError("Requête JSON invalide."); }
}

async function handle(request: Request, context: Context) {
  try {
    const session = await mobileSession(request);
    if (!session) return json({ error: "Connecte-toi à Kaobase." }, 401);
    const { supabase, userId, email } = session;
    const { path } = await context.params;
    const route = path.join("/");
    const method = request.method;
    if (route === "setup" && method === "POST") {
      await completeSetup(supabase, v.setupInput.parse(await body(request)));
      revalidatePath("/", "layout");
      return json({ ok: true });
    }
    const status = await getOnboardingStatus(supabase, userId);
    if (status === "unavailable") return json({ error: "Le profil est momentanément inaccessible." }, 503);
    if (route === "bootstrap" && method === "GET") {
      const { data: profile, error } = await supabase.from("profiles").select("id, display_name, currency, timezone, onboarding_completed_at").eq("id", userId).single();
      if (error) throw error;
      const accounts = await supabase.from("accounts").select("id, name, kind, space, opening_balance").order("created_at").order("id").limit(1);
      if (accounts.error) throw accounts.error;
      return json({ profile: { ...profile, email }, setupAccount: accounts.data?.[0] ?? null });
    }
    if (status !== "complete") return json({ error: "Termine la configuration de ton compte.", code: "SETUP_REQUIRED" }, 409);
    const url = new URL(request.url);
    const space = v.spaceFilter.parse(url.searchParams.get("space") ?? "all");
    const month = v.month.parse(url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7));
    if (method === "GET" && route === "overview") {
      const accounts = await getAccounts(supabase, space);
      const accountIds = space === "all" ? undefined : accounts.map((a) => a.id);
      const [categories, summary, budgets, transactions, subscriptions, tasks, apps, connections] = await Promise.all([
        getCategories(supabase), monthSummary(supabase, month, accountIds), budgetStatus(supabase, month, accountIds),
        listTransactions(supabase, { limit: 20, accountIds }), listSubscriptions(supabase, ["active", "suggested"], space),
        listTasks(supabase, undefined, space), listAppShortcuts(supabase, space), listAppConnections(supabase),
      ]);
      return json({ accounts, categories, summary, budgets: budgets ?? [], transactions, subscriptions, tasks, apps, connections });
    }
    if (method === "GET" && route === "transactions") {
      const offset = z.coerce.number().int().min(0).max(1e7).parse(url.searchParams.get("offset") ?? 0);
      const accounts = await getAccounts(supabase, space);
      return json(await listTransactions(supabase, { offset, limit: 100, accountIds: space === "all" ? undefined : accounts.map((a) => a.id), search: (url.searchParams.get("search") ?? "").slice(0, 200) }));
    }
    if (method === "GET" && route === "catalog") return json(await getAppCatalog());
    if (method === "POST") {
      const input = await body(request);
      if (route === "transactions") await addManualTransaction(supabase, v.transactionInput.parse(input));
      else if (route === "tasks") await createTask(supabase, v.taskInput.parse(input));
      else if (route === "subscriptions") await createSubscription(supabase, v.subscriptionInput.parse(input));
      else if (route === "accounts") await createAccount(supabase, v.accountInput.parse(input));
      else if (route === "budgets") { const p = v.budgetInput.parse(input); await setBudget(supabase, p.categoryId, p.monthlyLimit); }
      else if (route === "profile") {
        const p = v.profileInput.parse(input);
        const { error } = await supabase.from("profiles").update({ display_name: p.displayName, currency: p.currency, timezone: p.timezone }).eq("id", userId);
        if (error) throw error;
      } else if (route === "apps") {
        const values = z.record(z.string(), z.union([z.string(), z.boolean()])).parse(input);
        const form = new FormData();
        for (const [key, value] of Object.entries(values)) form.set(key, String(value));
        await createAppShortcut(supabase, parseAppForm(form));
      } else if (route === "agents") {
        const p = v.agentInput.parse(input);
        const limit = await checkUserLimit(supabase);
        if (!limit.allowed) return json({ error: limit.message }, 429);
        const { data: profile, error } = await supabase.from("profiles").select("currency, timezone").eq("id", userId).single();
        if (error) throw error;
        return json(await askAgent(supabase, { ...p, currency: profile.currency, timezone: profile.timezone }));
      } else if (route === "agents/decision") {
        const p = z.object({ requestId: v.uuid, conversationId: v.uuid, decision: z.enum(["confirm", "cancel"]) }).strict().parse(input);
        if (p.decision === "confirm") {
          const { data, error } = await supabase.rpc("confirm_agent_deletion", { p_request_id: p.requestId, p_conversation_id: p.conversationId });
          if (error) throw error;
          if (!data?.[0]) throw new UserError("Confirmation introuvable ou expirée.");
        } else {
          const { data, error } = await supabase.from("agent_deletion_requests").delete().eq("id", p.requestId).eq("conversation_id", p.conversationId).select("id").maybeSingle();
          if (error) throw error;
          if (!data) throw new UserError("Confirmation introuvable ou expirée.");
        }
      } else return json({ error: "Route introuvable." }, 404);
    } else if ((method === "PATCH" || method === "DELETE") && path.length === 2) {
      const id = v.uuid.parse(path[1]);
      if (method === "PATCH") {
        const input = await body(request);
        if (path[0] === "tasks") await updateTask(supabase, id, v.taskPatch.parse(input));
        else if (path[0] === "subscriptions") await updateSubscription(supabase, id, v.subscriptionPatch.parse(input));
        else if (path[0] === "apps") await pinAppShortcut(supabase, id, v.pinInput.parse(input).pinned);
        else if (path[0] === "transactions") await setTransactionCategory(supabase, id, z.object({ categoryId: v.uuid.nullable() }).strict().parse(input).categoryId);
        else return json({ error: "Route introuvable." }, 404);
      } else {
        if (path[0] === "transactions") await deleteTransaction(supabase, id);
        else if (path[0] === "tasks") await deleteTask(supabase, id);
        else if (path[0] === "subscriptions") await deleteSubscription(supabase, id);
        else if (path[0] === "budgets") await deleteBudget(supabase, id);
        else if (path[0] === "apps") {
          if (await getShortcutConnection(supabase, id)) throw new UserError("Déconnecte d'abord ce service depuis Kaobase sur le web.");
          await deleteAppShortcut(supabase, id);
        } else return json({ error: "Route introuvable." }, 404);
      }
    } else return json({ error: "Route introuvable." }, 404);
    revalidatePath("/", "layout");
    return json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: "Vérifie les informations saisies." }, 400);
    if (error instanceof UserError) return json({ error: error.message }, 400);
    if (error instanceof LimitUnavailableError) return json({ error: error.message }, 503);
    // Neither upstream responses nor bearer tokens enter mobile responses/logs.
    return json({ error: friendlyError(error) }, 500);
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
