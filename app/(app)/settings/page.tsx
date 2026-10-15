import { requireUser } from "@/lib/auth";
import { getAccounts, getCategories } from "@/lib/data/finance";
import { env } from "@/lib/env";
import { money } from "@/lib/ui/format";
import { createAccountAction, createCategoryAction, updateProfileAction } from "../actions";
import { FormAction } from "../_components/form-action";

export default async function SettingsPage() {
  const { supabase, userId, email } = await requireUser();
  const [{ data: profile }, accounts, categories] = await Promise.all([
    supabase.from("profiles").select("display_name, currency").eq("id", userId).single(),
    getAccounts(supabase),
    getCategories(supabase),
  ]);
  const providers = [
    { name: "Groq", ok: Boolean(env.groqKey()), model: env.groqModel(), role: "répond en premier" },
    { name: "Gemini", ok: Boolean(env.geminiKey()), model: env.geminiModel(), role: "prend le relais si Groq ne répond pas" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="page-title">Réglages</h1>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="section-title">Toi</h2>
          <p className="mb-3 text-sm text-ink-2">{email}</p>
          <FormAction action={updateProfileAction} submitLabel="Enregistrer" reset={false} className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label" htmlFor="displayName">Prénom</label>
              <input className="input" id="displayName" name="displayName" defaultValue={profile?.display_name ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="currency">Devise</label>
              <input className="input" id="currency" name="currency" defaultValue={profile?.currency ?? "EUR"} maxLength={3} />
            </div>
          </FormAction>
        </div>

        <div className="card">
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
            Les clés d&apos;accès restent sur le serveur : elles ne sont jamais envoyées à ton navigateur.
          </p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="section-title">Comptes bancaires</h2>
          <ul className="mb-4 divide-y divide-line text-sm">
            {accounts.map((a) => (
              <li key={a.id} className="flex justify-between py-2">
                <span>{a.name}</span>
                <span className="num text-ink-2">{money(Number(a.balance))}</span>
              </li>
            ))}
          </ul>
          <FormAction action={createAccountAction} submitLabel="Ajouter le compte" className="grid grid-cols-2 gap-3">
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
        </div>

        <div className="card">
          <h2 className="section-title">Catégories</h2>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <span key={c.id} className="badge">
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.name}
              </span>
            ))}
          </div>
          <FormAction action={createCategoryAction} submitLabel="Ajouter la catégorie" className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="cat-name">Nom</label>
              <input className="input" id="cat-name" name="name" required />
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
        </div>
      </section>
    </div>
  );
}
