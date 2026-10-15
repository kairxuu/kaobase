import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import type { Task, TaskPriority, TaskStatus } from "@/lib/types";
import { listSubscriptions } from "./subscriptions";

const TASK_COLUMNS =
  "id, title, description, status, priority, due_date, subscription_id, transaction_id, created_by, created_at, completed_at";

export async function listTasks(supabase: Supabase, statuses?: TaskStatus[]): Promise<Task[]> {
  let q = supabase.from("tasks").select(TASK_COLUMNS);
  if (statuses?.length) q = q.in("status", statuses);
  const { data, error } = await q.order("due_date", { ascending: true, nullsFirst: false }).order("created_at");
  if (error) throw new Error(error.message);
  return data as Task[];
}

export async function createTask(
  supabase: Supabase,
  input: {
    title: string;
    description?: string | null;
    priority?: TaskPriority;
    dueDate?: string | null;
    subscriptionId?: string | null;
    transactionId?: string | null;
    createdBy?: "user" | "agent";
  },
) {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "medium",
      due_date: input.dueDate ?? null,
      subscription_id: input.subscriptionId ?? null,
      transaction_id: input.transactionId ?? null,
      created_by: input.createdBy ?? "user",
    })
    .select(TASK_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as Task;
}

export async function updateTask(
  supabase: Supabase,
  id: string,
  patch: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "due_date">>,
) {
  const update: Record<string, unknown> = { ...patch };
  if (patch.status) update.completed_at = patch.status === "done" ? new Date().toISOString() : null;
  const { data, error } = await supabase.from("tasks").update(update).eq("id", id).select(TASK_COLUMNS).single();
  if (error) throw new Error(error.message);
  return data as Task;
}

export async function deleteTask(supabase: Supabase, id: string) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// Crée une tâche de vérification pour chaque abonnement actif qui tombe dans les `days` prochains jours
// (sans doublon si une tâche ouverte existe déjà pour cet abonnement).
export async function planSubscriptionReminders(supabase: Supabase, days = 7) {
  const horizon = new Date();
  horizon.setUTCDate(horizon.getUTCDate() + days);
  const limit = horizon.toISOString().slice(0, 10);

  const [subs, open] = await Promise.all([listSubscriptions(supabase, ["active"]), listTasks(supabase, ["todo", "doing"])]);
  const covered = new Set(open.map((t) => t.subscription_id).filter(Boolean));
  const created: Task[] = [];
  for (const s of subs) {
    if (!s.next_due || s.next_due > limit || covered.has(s.id)) continue;
    created.push(
      await createTask(supabase, {
        title: `Prélèvement ${s.name} : ${s.amount.toFixed(2)} €`,
        description: "Vérifier le solde ou résilier avant l'échéance si l'abonnement n'est plus utile.",
        priority: s.amount >= 30 ? "high" : "medium",
        dueDate: s.next_due,
        subscriptionId: s.id,
        createdBy: "agent",
      }),
    );
  }
  return created;
}
