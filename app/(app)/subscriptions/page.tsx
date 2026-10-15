import { requireUser } from "@/lib/auth";
import { listSubscriptions } from "@/lib/data/subscriptions";
import { annualCost, monthlyCost } from "@/lib/learning/subscriptions";
import { daysUntil, money, PERIOD_LABEL, shortDate } from "@/lib/ui/format";
import {
  createSubscriptionAction,
  detectSubscriptionsAction,
  setSubscriptionStatusAction,
  updateSubscriptionAction,
} from "../actions";
import { ActionButton } from "../_components/action-button";
import { FormAction } from "../_components/form-action";

const PERIODS = [
  ["monthly", "Mensuel"],
  ["yearly", "Annuel"],
  ["quarterly", "Trimestriel"],
  ["weekly", "Hebdomadaire"],
] as const;

export default async function SubscriptionsPage() {
  const { supabase } = await requireUser();
  const subs = await listSubscriptions(supabase, ["active", "suggested", "cancelled"]);
  const active = subs.filter((s) => s.status === "active");
  const suggested = subs.filter((s) => s.status === "suggested");
  const cancelled = subs.filter((s) => s.status === "cancelled");
  const monthly = active.reduce((s, x) => s + monthlyCost(x.amount, x.period), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Abonnements</h1>
          <p className="text-sm text-ink-2">
            <span className="num">{money(monthly)}</span> / mois · <span className="num">{money(monthly * 12)}</span> / an ·{" "}
            {active.length} actifs
          </p>
        </div>
        <ActionButton
          action={detectSubscriptionsAction}
          className="btn-ghost"
          success={(d) => {
            const r = d as { created: number; updated: number };
            return `${r.created} nouveau(x), ${r.updated} mis à jour`;
          }}
        >
          Relancer la détection
        </ActionButton>
      </header>

      {suggested.length > 0 && (
        <section className="card border-warn">
          <h2 className="card-title">Détectés automatiquement — à confirmer</h2>
          <p className="mb-3 text-xs text-ink-3">
            Un rejet est mémorisé : ce marchand ne sera plus jamais reproposé.
          </p>
          <ul className="divide-y divide-line">
            {suggested.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-ink-3">
                    <span className="num">{money(s.amount)}</span> / {PERIOD_LABEL[s.period]} · prochain {shortDate(s.next_due)} · confiance{" "}
                    {Math.round(s.confidence * 100)} %
                  </p>
                </div>
                <div className="flex gap-2">
                  <ActionButton action={setSubscriptionStatusAction.bind(null, s.id, "active")} className="btn-primary btn-sm">
                    Confirmer
                  </ActionButton>
                  <ActionButton action={setSubscriptionStatusAction.bind(null, s.id, "rejected")}>
                    Pas un abonnement
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Abonnement</th>
              <th className="text-right">Montant</th>
              <th className="text-right">Par an</th>
              <th>Prochaine échéance</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-ink-3">
                  Aucun abonnement actif. Importe un relevé ou ajoute-en un ci-dessous.
                </td>
              </tr>
            )}
            {active.map((s) => {
              const days = daysUntil(s.next_due);
              return (
                <tr key={s.id}>
                  <td>
                    <details>
                      <summary className="cursor-pointer font-medium">{s.name}</summary>
                      <FormAction
                        action={updateSubscriptionAction.bind(null, s.id)}
                        submitLabel="Enregistrer"
                        reset={false}
                        className="mt-3 grid max-w-md grid-cols-2 gap-2"
                      >
                        <input className="input col-span-2" name="name" defaultValue={s.name} aria-label="Nom" />
                        <input className="input" name="amount" defaultValue={s.amount} inputMode="decimal" aria-label="Montant" />
                        <select className="input" name="period" defaultValue={s.period} aria-label="Période">
                          {PERIODS.map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                        <input className="input col-span-2" name="nextDue" type="date" defaultValue={s.next_due ?? ""} aria-label="Prochaine échéance" />
                      </FormAction>
                    </details>
                  </td>
                  <td className="num whitespace-nowrap text-right">
                    {money(s.amount)} <span className="text-xs text-ink-3">/ {PERIOD_LABEL[s.period]}</span>
                  </td>
                  <td className="num whitespace-nowrap text-right text-ink-2">{money(annualCost(s.amount, s.period))}</td>
                  <td className="whitespace-nowrap">
                    {shortDate(s.next_due)}
                    {days != null && days <= 7 && <span className="badge ml-2 bg-warn-soft text-warn">J-{days}</span>}
                  </td>
                  <td className="text-right">
                    <ActionButton
                      action={setSubscriptionStatusAction.bind(null, s.id, "cancelled")}
                      confirm={`Marquer ${s.name} comme résilié ?`}
                    >
                      Résilié
                    </ActionButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="card-title">Ajouter un abonnement</h2>
          <FormAction action={createSubscriptionAction} submitLabel="Ajouter" className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label" htmlFor="sub-name">Nom</label>
              <input className="input" id="sub-name" name="name" required />
            </div>
            <div>
              <label className="label" htmlFor="sub-amount">Montant</label>
              <input className="input" id="sub-amount" name="amount" inputMode="decimal" required />
            </div>
            <div>
              <label className="label" htmlFor="sub-period">Période</label>
              <select className="input" id="sub-period" name="period">
                {PERIODS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="sub-due">Prochaine échéance</label>
              <input className="input" id="sub-due" name="nextDue" type="date" />
            </div>
          </FormAction>
        </div>
        {cancelled.length > 0 && (
          <div className="card">
            <h2 className="card-title">Résiliés</h2>
            <ul className="divide-y divide-line text-sm">
              {cancelled.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2">
                  <span className="text-ink-2">{s.name}</span>
                  <ActionButton action={setSubscriptionStatusAction.bind(null, s.id, "active")}>Réactiver</ActionButton>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
