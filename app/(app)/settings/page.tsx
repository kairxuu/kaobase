import type { Metadata } from "next";
import { getCurrency, requireUser } from "@/lib/auth";
import { getAccounts, getCategories } from "@/lib/data/finance";
import { budgetStatus, listBudgets } from "@/lib/data/budgets";
import { env } from "@/lib/env";
import { moneyIn } from "@/lib/ui/format";
import { PasswordForm } from "@/app/auth/reset/password-form";
import { createAccountAction, createCategoryAction } from "../actions";
import { FormAction } from "../_components/form-action";
import { AccountRow, BudgetRow, CategoryRow } from "./editors";
import { ProfileForm } from "./profile-form";
import { AVATAR_COLORS, getProfile } from "@/lib/data/account";

export const metadata: Metadata = { title: "Réglages" };

// Devises proposées : formatage seulement, aucun taux de change n'est appliqué.
const CURRENCIES = [
  ["EUR", "Euro (€)"],
  ["USD", "Dollar américain ($)"],
  ["GBP", "Livre sterling (£)"],
  ["CHF", "Franc suisse"],
  ["CAD", "Dollar canadien"],
  ["MAD", "Dirham marocain"],
  ["XOF", "Franc CFA (BCEAO)"],
  ["XAF", "Franc CFA (BEAC)"],
  ["TND", "Dinar tunisien"],
  ["DZD", "Dinar algérien"],
] as const;

const KIND_LABEL = { expense: "dépense", income: "revenu", transfer: "virement interne" } as const;

export default async function SettingsPage() {
  const { supabase, userId, email } = await requireUser();
  const currency = await getCurrency();
  const money = moneyIn(currency);
  const month = new Date().toISOString().slice(0, 7);
  const [profile, balances, { data: accountRows }, categories, budgets, statuses] = await Promise.all([
    getProfile(supabase, userId),
    getAccounts(supabase),
    supabase.from("accounts").select("id, name, opening_balance").order("name"),
    getCategories(supabase),
    listBudgets(supabase).catch(() => null),
    budgetStatus(supabase, month).catch(() => null),
  ]);
  const balanceOf = new Map(balances.map((a) => [a.id, Number(a.balance)]));
  const limitOf = new Map((budgets ?? []).map((b) => [b.category_id, b.monthly_limit]));
  const statusOf = new Map((statuses ?? []).map((s) => [s.categoryId, s]));
  const expenseCategories = categories.filter((c) => c.kind === "expense");
  const providers = [
    { name: "Groq", ok: Boolean(env.groqKey()), model: env.groqModel(), role: "répond en premier" },
    { name: "Gemini", ok: Boolean(env.geminiKey()), model: env.geminiModel(), role: "prend le relais si Groq ne répond pas" },
  ];

  return (
    <div className="space-y-10">
      <header>
        <h1 className="page-title">Réglages</h1>
        <p className="page-lede">Ton profil, tes comptes, tes catégories et tes budgets.</p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="section-title">Ton profil</h2>
          <p className="mb-4 text-xs text-ink-3">
            {email}
            {profile.memberSince && `, sur Kaobase depuis le ${new Date(profile.memberSince).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`}
          </p>
          <ProfileForm profile={profile} colors={AVATAR_COLORS} currencies={CURRENCIES} />
        </div>

        <div className="card">
          <h2 className="section-title">Mot de passe</h2>
          <PasswordForm />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="section-title">Comptes bancaires</h2>
          <ul className="mb-4 divide-y divide-line">
            {(accountRows ?? []).map((a) => (
              <AccountRow
                key={a.id as string}
                account={{ id: a.id as string, name: a.name as string, openingBalance: Number(a.opening_balance) }}
                balanceLabel={money(balanceOf.get(a.id as string) ?? 0)}
                canDelete={(accountRows ?? []).length > 1}
              />
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Ajouter un compte</summary>
            <FormAction action={createAccountAction} submitLabel="Ajouter le compte" className="mt-3 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label" htmlFor="acc-name">Nom</label>
                <input className="input" id="acc-name" name="name" required />
              </div>
              <div>
                <label className="label" htmlFor="acc-kind">Type</label>
                <select className="input" id="acc-kind" name="kind">
                  <option value="checking">Courant</option>
                  <option value="savings">Épargne</option>
                  <option value="card">Carte</option>
                  <option value="cash">Espèces</option>
                  <option value="other">Autre</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="acc-balance">Solde d&apos;ouverture</label>
                <input className="input" id="acc-balance" name="openingBalance" inputMode="decimal" defaultValue="0" />
              </div>
            </FormAction>
          </details>
        </div>

        <div className="card" id="categories">
          <h2 className="section-title">Catégories</h2>
          <ul className="mb-4 max-h-[26rem] divide-y divide-line overflow-y-auto pr-1">
            {categories.map((c) => (
              <CategoryRow key={c.id} category={{ id: c.id, name: c.name, color: c.color, kindLabel: KIND_LABEL[c.kind] }} />
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Ajouter une catégorie</summary>
            <FormAction action={createCategoryAction} submitLabel="Ajouter la catégorie" className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="cat-name">Nom</label>
                <input className="input" id="cat-name" name="name" required maxLength={40} />
              </div>
              <div>
                <label className="label" htmlFor="cat-kind">Type</label>
                <select className="input" id="cat-kind" name="kind">
                  <option value="expense">Dépense</option>
                  <option value="income">Revenu</option>
                  <option value="transfer">Virement interne</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="cat-color">Couleur</label>
                <input className="input h-[38px] p-1" id="cat-color" name="color" type="color" defaultValue="#64748b" />
              </div>
            </FormAction>
          </details>
        </div>
      </section>

      <section className="card" id="budgets">
        <h2 className="section-title">Budgets du mois</h2>
        {budgets === null ? (
          <p className="text-sm text-ink-2">
            Les budgets ne sont pas encore activés : exécute la migration{" "}
            <code>supabase/migrations/20261015120000_budgets.sql</code> dans Supabase.
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm text-ink-2">
              Fixe un plafond mensuel par catégorie de dépense. Tu peux aussi demander à l&apos;agent Finance : « mets 300 € pour
              l&apos;alimentation ».
            </p>
            <ul className="divide-y divide-line">
              {expenseCategories.map((c) => {
                const st = statusOf.get(c.id);
                const limit = limitOf.get(c.id) ?? null;
                return (
                  <BudgetRow
                    key={c.id}
                    category={{ id: c.id, name: c.name, color: c.color }}
                    limit={limit}
                    spentLabel={money(st?.spent ?? 0)}
                    limitLabel={limit ? money(limit) : null}
                    percent={st ? st.percent : null}
                  />
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">IA utilisée</h2>
        <ul className="space-y-2 text-sm">
          {providers.map((p) => (
            <li key={p.name} className="flex items-center justify-between">
              <span>
                <span className="font-medium">{p.name}</span>
                <span className="block text-xs text-ink-3">{p.role}, modèle {p.model}</span>
              </span>
              <span className={`text-xs ${p.ok ? "text-pos" : "text-ink-3"}`}>{p.ok ? "actif" : "non configuré"}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-3">
          Chaque compte peut poser 6 questions par minute et 150 par jour aux agents. Les clés d&apos;accès restent sur le
          serveur.
        </p>
      </section>
    </div>
  );
}
