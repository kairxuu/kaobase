"use client";

import { useState } from "react";
import type { TaskPriority } from "@/lib/types";
import { updateTaskAction } from "../actions";
import { FormAction } from "../_components/form-action";

// Modifier titre, description, priorité et échéance d'une tâche (revue F15).
export function TaskEditor({
  task,
}: {
  task: { id: string; title: string; description: string | null; priority: TaskPriority; dueDate: string | null };
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Modifier
      </button>
    );
  }
  return (
    <div className="mt-2 w-full">
      <FormAction
        action={async (fd) => {
          const res = await updateTaskAction(task.id, fd);
          if (res.ok) setOpen(false);
          return res;
        }}
        submitLabel="Enregistrer"
        reset={false}
        className="grid gap-2"
      >
        <input className="input" name="title" defaultValue={task.title} aria-label="Titre" required />
        <textarea className="input" name="description" defaultValue={task.description ?? ""} rows={2} aria-label="Description" />
        <div className="grid grid-cols-2 gap-2">
          <select className="input" name="priority" defaultValue={task.priority} aria-label="Priorité">
            <option value="high">Haute</option>
            <option value="medium">Moyenne</option>
            <option value="low">Basse</option>
          </select>
          <input className="input" name="dueDate" type="date" defaultValue={task.dueDate ?? ""} aria-label="Échéance" />
        </div>
      </FormAction>
      <button type="button" className="mt-1 text-xs text-ink-2 hover:text-ink" onClick={() => setOpen(false)}>Annuler</button>
    </div>
  );
}
