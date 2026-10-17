import { CategoryDonut } from "../_components/category-donut";
import { categoryDistribution } from "@/lib/distribution";
import { getCurrency, requireUser } from "@/lib/auth";
import { accountIdsFor, getSpaceFilter } from "@/lib/space";
import {
  getAccounts,
  getCategories,
  listTransactions,
  transactionDistributionRows,
  monthRange,
} from "@/lib/data/finance";
import { moneyIn, shortDate } from "@/lib/ui/format";
import {
  addTransactionAction,
  categorizeUncategorizedAction,
} from "../actions";
import { ActionButton } from "../_components/action-button";
import { FormAction } from "../_components/form-action";
import Link from "next/link";
import { CategorySelect } from "./category-select";
import { RowActions } from "./row-actions";

const PAGE_SIZE = 100;

const BY_LABEL = {
  rule: "règle apprise",
  llm: "proposé par l'IA",
  user: "choisi par toi",
} as const;

export default async function TransactionsPage({
  searchParams,
}: PageProps<"/transactions">) {
  const params = await searchParams;
  const get = (k: string) =>
    typeof params[k] === "string" ? (params[k] as string) : undefined;
  const month = get("mois");
  const range =
    month && /^\d{4}-\d{2}$/.test(month) ? monthRange(month) : undefined;
  const page = Math.max(1, Number(get("page")) || 1);

  const { db } = await requireUser();
  const currency = await getCurrency();
  const money = moneyIn(currency);
  const space = await getSpaceFilter();
  const accountIds = await accountIdsFor(db, space);
  const [txs, categories, accounts, distribution] = await Promise.all([
    listTransactions(db, {
      ...range,
      categoryId: get("categorie") || undefined,
      uncategorized: get("non") === "1",
      search: get("q") || undefined,
      // Une ligne de plus que la page : indique s'il existe une page suivante.
      limit: PAGE_SIZE + 1,
      offset: (page - 1) * PAGE_SIZE,
      accountIds,
    }),
    getCategories(db),
    getAccounts(db, space),
    transactionDistributionRows(db, {
      ...range,
      categoryId: get("categorie") || undefined,
      uncategorized: get("non") === "1",
      search: get("q") || undefined,
      accountIds,
    }),
  ]);
  const hasNext = txs.length > PAGE_SIZE;
  const rows = txs.slice(0, PAGE_SIZE);
  const uncategorized = rows.filter((t) => !t.category_id).length;
  const pageHref = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params))
      if (typeof v === "string" && v && k !== "page") q.set(k, v);
    if (n > 1) q.set("page", String(n));
    const qs = q.toString();
    return `/transactions${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Opérations</h1>
          <p className="page-lede">
            Change la catégorie d&apos;une opération : Kaobase applique ton
            choix aux autres opérations du même commerçant, et s&apos;en
            souviendra pour les prochains imports.
          </p>
        </div>
        <ActionButton
          action={categorizeUncategorizedAction}
          className="btn-ghost"
        >
          Trier les opérations sans catégorie
        </ActionButton>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        method="get"
        role="search"
        action="/transactions"
      >
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor="q">
            Recherche
          </label>
          <input
            className="input"
            id="q"
            name="q"
            defaultValue={get("q")}
            placeholder="Netflix, loyer, Carrefour…"
          />
        </div>
        <div>
          <label className="label" htmlFor="mois">
            Mois
          </label>
          <input
            className="input"
            id="mois"
            name="mois"
            type="month"
            defaultValue={month}
          />
        </div>
        <div>
          <label className="label" htmlFor="categorie">
            Catégorie
          </label>
          <select
            className="input"
            id="categorie"
            name="categorie"
            defaultValue={get("categorie") ?? ""}
          >
            <option value="">Toutes</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="non"
            value="1"
            defaultChecked={get("non") === "1"}
            className="accent-accent"
          />{" "}
          Sans catégorie seulement
        </label>
        <button className="btn-ghost">Filtrer</button>
      </form>

      <CategoryDonut
        items={categoryDistribution(distribution, categories)}
        currency={currency}
        title="Répartition des dépenses"
        description="Toutes les opérations correspondant aux filtres · hors virements internes"
      />

      <div className="-mx-3 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Libellé</th>
              <th className="text-right">Montant</th>
              <th>Catégorie</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-ink-3">
                  Aucune opération ne correspond. Élargis les filtres ou importe
                  un relevé.
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap text-ink-2">
                  {shortDate(t.booked_at)}
                </td>
                <td>
                  <div className="font-medium">{t.merchant}</div>
                  <div className="max-w-md truncate text-xs text-ink-3">
                    {t.label_raw}
                  </div>
                </td>
                <td
                  className={`num whitespace-nowrap text-right ${t.amount > 0 ? "text-pos" : ""}`}
                >
                  {money(t.amount)}
                </td>
                <td className="whitespace-nowrap">
                  <CategorySelect
                    transactionId={t.id}
                    value={t.category_id}
                    categories={categories}
                  />
                  {t.categorized_by && (
                    <span className="ml-2 text-xs text-ink-3">
                      {BY_LABEL[t.categorized_by]}
                    </span>
                  )}
                </td>
                <td className="text-right">
                  <RowActions
                    row={{
                      id: t.id,
                      bookedAt: t.booked_at,
                      label: t.label_raw,
                      amount: t.amount,
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(page > 1 || hasNext) && (
        <nav
          className="flex items-center justify-between text-sm"
          aria-label="Pages"
        >
          {page > 1 ? (
            <Link className="btn-ghost btn-sm" href={pageHref(page - 1)}>
              Page précédente
            </Link>
          ) : (
            <span />
          )}
          <span className="text-ink-3">Page {page}</span>
          {hasNext ? (
            <Link className="btn-ghost btn-sm" href={pageHref(page + 1)}>
              Page suivante
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
      {uncategorized > 0 && (
        <p className="text-xs text-ink-3">
          {uncategorized === 1
            ? "Une opération"
            : `${uncategorized} opérations`}{" "}
          sans catégorie dans cette liste.
        </p>
      )}

      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">
          Ajouter une opération à la main
        </summary>
        <FormAction
          action={addTransactionAction}
          submitLabel="Ajouter"
          className="mt-4 grid gap-3 sm:grid-cols-3"
        >
          <div className="sm:col-span-2">
            <label className="label" htmlFor="label">
              Libellé
            </label>
            <input className="input" id="label" name="label" required />
          </div>
          <div>
            <label className="label" htmlFor="bookedAt">
              Date
            </label>
            <input
              className="input"
              id="bookedAt"
              name="bookedAt"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <div>
            <label className="label" htmlFor="amount">
              Montant
            </label>
            <input
              className="input"
              id="amount"
              name="amount"
              inputMode="decimal"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="direction">
              Sens
            </label>
            <select className="input" id="direction" name="direction">
              <option value="expense">Dépense</option>
              <option value="income">Revenu</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="categoryId">
              Catégorie
            </label>
            <select className="input" id="categoryId" name="categoryId">
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <label className="label" htmlFor="accountId">
              Compte
            </label>
            <select className="input" id="accountId" name="accountId">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </FormAction>
      </details>
    </div>
  );
}
