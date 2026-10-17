"use client";

import { useState, type ReactNode } from "react";
import {
  deleteAccountAction,
  deleteBudgetAction,
  deleteCategoryAction,
  renameCategoryAction,
  setBudgetAction,
  updateAccountAction,
} from "../actions";
import { ActionButton } from "../_components/action-button";
import { FormAction } from "../_components/form-action";

// Ligne affichée en lecture, qui bascule en formulaire au clic sur « Modifier ».
function EditableRow({
  view,
  form,
}: {
  view: ReactNode;
  form: (close: () => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="py-2.5">
      {editing ? (
        <div className="space-y-2">
          {form(() => setEditing(false))}
          <button
            type="button"
            className="text-xs text-ink-2 hover:text-ink"
            onClick={() => setEditing(false)}
          >
            Annuler
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          {view}
          <button
            type="button"
            className="btn-ghost btn-sm shrink-0"
            onClick={() => setEditing(true)}
          >
            Modifier
          </button>
        </div>
      )}
    </li>
  );
}

const closeOnSuccess =
  <T,>(
    action: (fd: FormData) => Promise<T & { ok: boolean }>,
    close: () => void,
  ) =>
  async (fd: FormData) => {
    const res = await action(fd);
    if (res.ok) close();
    return res;
  };

export function AccountRow({
  account,
  balanceLabel,
  canDelete,
}: {
  account: {
    id: string;
    name: string;
    kind: string;
    openingBalance: number;
    space: "perso" | "pro";
  };
  balanceLabel: string;
  canDelete: boolean;
}) {
  return (
    <EditableRow
      view={
        <span className="flex flex-1 justify-between gap-3 text-sm">
          <span>
            {account.name}
            <span className="ml-2 text-xs text-ink-3">
              {account.space === "pro" ? "pro" : "perso"}
            </span>
          </span>
          <span className="num text-ink-2">{balanceLabel}</span>
        </span>
      }
      form={(close) => (
        <>
          <FormAction
            action={closeOnSuccess(
              updateAccountAction.bind(null, account.id),
              close,
            )}
            submitLabel="Enregistrer"
            reset={false}
            className="grid grid-cols-2 gap-2"
          >
            <input
              className="input col-span-2"
              name="name"
              defaultValue={account.name}
              aria-label="Nom du compte"
              required
            />
            <select
              className="input"
              name="kind"
              defaultValue={account.kind}
              aria-label="Type de compte"
            >
              <option value="checking">Courant</option>
              <option value="savings">Épargne</option>
              <option value="card">Carte</option>
              <option value="cash">Espèces</option>
              <option value="other">Autre</option>
            </select>
            <select
              className="input"
              name="space"
              defaultValue={account.space}
              aria-label="Espace du compte"
            >
              <option value="perso">Perso</option>
              <option value="pro">Pro</option>
            </select>
            <input
              className="input"
              name="openingBalance"
              inputMode="decimal"
              defaultValue={account.openingBalance.toFixed(2).replace(".", ",")}
              aria-label="Solde d'ouverture"
            />
          </FormAction>
          {canDelete && (
            <ActionButton
              action={deleteAccountAction.bind(null, account.id)}
              confirm={`Supprimer « ${account.name} » et toutes ses opérations ? C'est définitif.`}
            >
              Supprimer le compte et ses opérations
            </ActionButton>
          )}
        </>
      )}
    />
  );
}

export function CategoryRow({
  category,
}: {
  category: { id: string; name: string; color: string; kindLabel: string };
}) {
  return (
    <EditableRow
      view={
        <span className="flex flex-1 items-center gap-2 text-sm">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: category.color }}
            aria-hidden
          />
          {category.name}
          <span className="text-xs text-ink-3">{category.kindLabel}</span>
        </span>
      }
      form={(close) => (
        <>
          <FormAction
            action={closeOnSuccess(
              renameCategoryAction.bind(null, category.id),
              close,
            )}
            submitLabel="Enregistrer"
            reset={false}
            className="grid grid-cols-[1fr_auto] gap-2"
          >
            <input
              className="input"
              name="name"
              defaultValue={category.name}
              aria-label="Nom de la catégorie"
              required
              maxLength={40}
            />
            <input
              className="input h-[38px] w-14 p-1"
              name="color"
              type="color"
              defaultValue={category.color}
              aria-label="Couleur"
            />
          </FormAction>
          <ActionButton
            action={deleteCategoryAction.bind(null, category.id)}
            confirm={`Supprimer « ${category.name} » ? Ses opérations deviendront « sans catégorie » et son budget sera retiré.`}
          >
            Supprimer la catégorie
          </ActionButton>
        </>
      )}
    />
  );
}

export function BudgetRow({
  category,
  limit,
  spentLabel,
  limitLabel,
  percent,
}: {
  category: { id: string; name: string; color: string };
  limit: number | null;
  spentLabel: string;
  limitLabel: string | null;
  percent: number | null;
}) {
  return (
    <EditableRow
      view={
        <span className="flex-1 text-sm">
          <span className="flex justify-between gap-3">
            <span>{category.name}</span>
            <span
              className={`num ${percent != null && percent > 100 ? "text-neg" : "text-ink-2"}`}
            >
              {spentLabel}
              {limitLabel ? (
                <span className="text-ink-3"> sur {limitLabel}</span>
              ) : (
                <span className="text-ink-3"> ce mois, sans budget</span>
              )}
            </span>
          </span>
          {percent != null && (
            <span className="mt-1.5 block h-[3px] bg-surface-2">
              <span
                className="block h-[3px]"
                style={{
                  width: `${Math.min(100, percent)}%`,
                  background: percent > 100 ? "var(--loss)" : category.color,
                }}
              />
            </span>
          )}
        </span>
      }
      form={(close) => (
        <>
          <FormAction
            action={closeOnSuccess(setBudgetAction, close)}
            submitLabel="Enregistrer le budget"
            reset={false}
            className="flex items-end gap-2"
          >
            <input type="hidden" name="categoryId" value={category.id} />
            <div className="flex-1">
              <label className="label" htmlFor={`budget-${category.id}`}>
                Budget mensuel pour {category.name}
              </label>
              <input
                className="input"
                id={`budget-${category.id}`}
                name="limit"
                inputMode="decimal"
                defaultValue={limit ? limit.toFixed(2).replace(".", ",") : ""}
                placeholder="300"
                required
              />
            </div>
          </FormAction>
          {limit != null && (
            <ActionButton
              action={deleteBudgetAction.bind(null, category.id)}
              onSuccess={close}
            >
              Retirer le budget
            </ActionButton>
          )}
        </>
      )}
    />
  );
}
