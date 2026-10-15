import { requireUser } from "@/lib/auth";
import { listTasks } from "@/lib/data/tasks";
import type { TaskStatus } from "@/lib/types";
import { PRIORITY_LABEL, shortDate, STATUS_LABEL } from "@/lib/ui/format";
import { createTaskAction, deleteTaskAction, planRemindersAction, setTaskStatusAction } from "../actions";
import { ActionButton } from "../_components/action-button";
import { FormAction } from "../_components/form-action";

const COLUMNS: TaskStatus[] = ["todo", "doing", "done"];
const PRIORITY_TONE = { high: "bg-warn-soft text-warn", medium: "", low: "text-ink-3" } as const;

export default async function TasksPage() {
  const { supabase } = await requireUser();
  const tasks = await listTasks(supabase);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tâches</h1>
          <p className="text-sm text-ink-2">Les tâches créées par un agent portent le badge « agent ».</p>
        </div>
        <ActionButton
          action={planRemindersAction}
          className="btn-ghost"
        >
          Rappels des prélèvements à 7 jours
        </ActionButton>
      </header>

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Nouvelle tâche</summary>
        <FormAction action={createTaskAction} submitLabel="Créer" className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="title">Titre</label>
            <input className="input" id="title" name="title" required />
          </div>
          <div>
            <label className="label" htmlFor="priority">Priorité</label>
            <select className="input" id="priority" name="priority" defaultValue="medium">
              <option value="high">Haute</option>
              <option value="medium">Moyenne</option>
              <option value="low">Basse</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="dueDate">Échéance</label>
            <input className="input" id="dueDate" name="dueDate" type="date" />
          </div>
          <div className="sm:col-span-4">
            <label className="label" htmlFor="description">Description</label>
            <textarea className="input" id="description" name="description" rows={2} />
          </div>
        </FormAction>
      </details>

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col);
          return (
            <section key={col} className="rounded-xl bg-surface-2 p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold">
                {STATUS_LABEL[col]} <span className="badge bg-surface">{items.length}</span>
              </h2>
              <ul className="space-y-2">
                {items.map((t) => (
                  <li key={t.id} className="rounded-lg border border-line bg-surface p-3">
                    <p className={`text-sm font-medium ${t.status === "done" ? "text-ink-3 line-through" : ""}`}>{t.title}</p>
                    {t.description && <p className="mt-1 text-xs text-ink-2">{t.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={`badge ${PRIORITY_TONE[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
                      {t.due_date && (
                        <span className={`badge ${t.status !== "done" && t.due_date < today ? "text-neg" : ""}`}>
                          {shortDate(t.due_date)}
                        </span>
                      )}
                      {t.created_by === "agent" && <span className="badge bg-accent-soft">agent</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {COLUMNS.filter((c) => c !== col).map((c) => (
                        <ActionButton key={c} action={setTaskStatusAction.bind(null, t.id, c)}>
                          → {STATUS_LABEL[c]}
                        </ActionButton>
                      ))}
                      <ActionButton action={deleteTaskAction.bind(null, t.id)} confirm="Supprimer cette tâche ?">
                        Supprimer
                      </ActionButton>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
