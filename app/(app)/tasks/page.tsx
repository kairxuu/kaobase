import { requireUser } from "@/lib/auth";
import { defaultSpace, getSpaceFilter } from "@/lib/space";
import { SpaceField } from "../_components/space-field";
import { listTasks } from "@/lib/data/tasks";
import type { TaskStatus } from "@/lib/types";
import { PRIORITY_LABEL, shortDate, STATUS_LABEL } from "@/lib/ui/format";
import { createTaskAction, deleteTaskAction, planRemindersAction, setTaskStatusAction } from "../actions";
import { ActionButton } from "../_components/action-button";
import { FormAction } from "../_components/form-action";
import { TaskEditor } from "./task-editor";

const COLUMNS: TaskStatus[] = ["todo", "doing", "done"];
const MOVE_LABEL = { todo: "Remettre à faire", doing: "Commencer", done: "Terminer" } as const;
const PRIORITY_TONE = { high: "bg-warn-soft text-warn", medium: "", low: "text-ink-3" } as const;

export default async function TasksPage() {
  const { supabase } = await requireUser();
  const space = await getSpaceFilter();
  const tasks = await listTasks(supabase, undefined, space);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Tâches</h1>
          <p className="page-lede">Tes démarches et rappels. Celles qu&apos;un agent a créées pour toi sont signalées.</p>
        </div>
        <ActionButton
          action={planRemindersAction}
          className="btn-ghost"
        >
          Me rappeler les prélèvements de la semaine
        </ActionButton>
      </header>

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Ajouter une tâche</summary>
        <FormAction action={createTaskAction} submitLabel="Ajouter la tâche" className="mt-4 grid gap-3 sm:grid-cols-4">
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
          <div className="sm:col-span-3">
            <label className="label" htmlFor="description">Description</label>
            <textarea className="input" id="description" name="description" rows={2} />
          </div>
          <SpaceField id="task-space" defaultValue={defaultSpace(space)} />
        </FormAction>
      </details>

      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => t.status === col);
          return (
            <section key={col} className="rounded-md bg-surface-2/70 p-3">
              <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold">
                {STATUS_LABEL[col]} <span className="badge bg-surface">{items.length}</span>
              </h2>
              <ul className="space-y-2">
                {items.map((t) => (
                  <li key={t.id} className="reply rounded-md bg-surface p-3 shadow-[0_1px_0_var(--rule)]">
                    <p className={`text-sm font-medium ${t.status === "done" ? "text-ink-3 line-through" : ""}`}>{t.title}</p>
                    {t.description && <p className="mt-1 text-xs text-ink-2">{t.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={`badge ${PRIORITY_TONE[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
                      {t.due_date && (
                        <span className={`badge ${t.status !== "done" && t.due_date < today ? "text-neg" : ""}`}>
                          {shortDate(t.due_date)}
                        </span>
                      )}
                      {t.created_by === "agent" && <span className="badge bg-accent-soft text-ink">créée par un agent</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {COLUMNS.filter((c) => c !== col).map((c) => (
                        <ActionButton key={c} action={setTaskStatusAction.bind(null, t.id, c)}>
                          {MOVE_LABEL[c]}
                        </ActionButton>
                      ))}
                      <TaskEditor
                        task={{ id: t.id, title: t.title, description: t.description, priority: t.priority, dueDate: t.due_date }}
                      />
                      <ActionButton action={deleteTaskAction.bind(null, t.id)} confirm={`Supprimer « ${t.title} » ?`}>
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
