import { requireUser } from "@/lib/auth";
import { getAccounts, getCategories, listTransactions, monthRange } from "@/lib/data/finance";
import { money, shortDate } from "@/lib/ui/format";
import { addTransactionAction, categorizeUncategorizedAction } from "../actions";
import { ActionButton } from "../_components/action-button";
import { FormAction } from "../_components/form-action";
import { CategorySelect } from "./category-select";

const BY_LABEL = { rule: "règle", llm: "IA", user: "toi" } as const;

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const params = await searchParams;
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const month = get("mois");
  const range = month && /^\d{4}-\d{2}$/.test(month) ? monthRange(month) : undefined;

  const { supabase } = await requireUser();
  const [txs, categories, accounts] = await Promise.all([
    listTransactions(supabase, {
      ...range,
      categoryId: get("categorie") || undefined,
      uncategorized: get("non") === "1",
      search: get("q") || undefined,
      limit: 300,
    }),
    getCategories(supabase),
    getAccounts(supabase),
  ]);
  const uncategorized = txs.filter((t) => !t.category_id).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
          <p className="text-sm text-ink-2">
            Corrige une catégorie : KAOBASE en tire une règle et l&apos;applique aux opérations du même marchand.
          </p>
        </div>
        <ActionButton
          action={categorizeUncategorizedAction}
          className="btn-ghost"
        >
          Catégoriser les non classées
        </ActionButton>
      </header>

      <form className="card flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor="q">Recherche</label>
          <input className="input" id="q" name="q" defaultValue={get("q")} placeholder="Libellé ou marchand" />
        </div>
        <div>
          <label className="label" htmlFor="mois">Mois</label>
          <input className="input" id="mois" name="mois" type="month" defaultValue={month} />
        </div>
        <div>
          <label className="label" htmlFor="categorie">Catégorie</label>
          <select className="input" id="categorie" name="categorie" defaultValue={get("categorie") ?? ""}>
            <option value="">Toutes</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="non" value="1" defaultChecked={get("non") === "1"} /> Non catégorisées
        </label>
        <button className="btn-ghost">Filtrer</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Libellé</th>
              <th className="text-right">Montant</th>
              <th>Catégorie</th>
            </tr>
          </thead>
          <tbody>
            {txs.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-ink-3">Aucune transaction.</td>
              </tr>
            )}
            {txs.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap text-ink-2">{shortDate(t.booked_at)}</td>
                <td>
                  <div className="font-medium">{t.merchant}</div>
                  <div className="max-w-md truncate text-xs text-ink-3">{t.label_raw}</div>
                </td>
                <td className={`num whitespace-nowrap text-right ${t.amount > 0 ? "text-pos" : ""}`}>{money(t.amount)}</td>
                <td className="whitespace-nowrap">
                  <CategorySelect transactionId={t.id} value={t.category_id} categories={categories} />
                  {t.categorized_by && <span className="badge ml-2">{BY_LABEL[t.categorized_by]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {uncategorized > 0 && <p className="text-xs text-ink-3">{uncategorized} transaction(s) sans catégorie dans cette vue.</p>}

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">Ajouter une opération manuelle</summary>
        <FormAction action={addTransactionAction} submitLabel="Ajouter" className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="label">Libellé</label>
            <input className="input" id="label" name="label" required />
          </div>
          <div>
            <label className="label" htmlFor="bookedAt">Date</label>
            <input className="input" id="bookedAt" name="bookedAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <div>
            <label className="label" htmlFor="amount">Montant</label>
            <input className="input" id="amount" name="amount" inputMode="decimal" required />
          </div>
          <div>
            <label className="label" htmlFor="direction">Sens</label>
            <select className="input" id="direction" name="direction">
              <option value="expense">Dépense</option>
              <option value="income">Revenu</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="categoryId">Catégorie</label>
            <select className="input" id="categoryId" name="categoryId">
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <label className="label" htmlFor="accountId">Compte</label>
            <select className="input" id="accountId" name="accountId">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </FormAction>
      </details>
    </div>
  );
}
