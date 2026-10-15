"use client";

import { useState } from "react";
import { deleteTransactionAction, updateTransactionAction } from "../actions";
import { ActionButton } from "../_components/action-button";
import { FormAction } from "../_components/form-action";

type Row = { id: string; bookedAt: string; label: string; amount: number };

// Modifier ou supprimer une opération directement depuis la liste (revue F7).
export function RowActions({ row }: { row: Row }) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <span className="inline-flex gap-1.5">
        <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Modifier</button>
        <ActionButton
          action={deleteTransactionAction.bind(null, row.id)}
          confirm={`Supprimer « ${row.label} » du ${row.bookedAt} ? Cette opération disparaîtra de tes comptes.`}
        >
          Supprimer
        </ActionButton>
      </span>
    );
  }

  return (
    <FormAction
      action={async (fd) => {
        const res = await updateTransactionAction(row.id, fd);
        if (res.ok) setEditing(false);
        return res;
      }}
      submitLabel="Enregistrer"
      reset={false}
      className="grid min-w-[18rem] gap-2"
    >
      <input className="input" name="label" defaultValue={row.label} aria-label="Libellé" required />
      <div className="grid grid-cols-2 gap-2">
        <input className="input" name="bookedAt" type="date" defaultValue={row.bookedAt} aria-label="Date" required />
        <input className="input" name="amount" inputMode="decimal" defaultValue={Math.abs(row.amount).toFixed(2).replace(".", ",")} aria-label="Montant" required />
      </div>
      <select className="input" name="direction" defaultValue={row.amount > 0 ? "income" : "expense"} aria-label="Sens">
        <option value="expense">Dépense</option>
        <option value="income">Revenu</option>
      </select>
      <button type="button" className="text-left text-xs text-ink-2 hover:text-ink" onClick={() => setEditing(false)}>Annuler</button>
    </FormAction>
  );
}
