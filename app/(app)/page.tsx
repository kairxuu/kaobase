import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getTotalBalance, listTransactions, monthSummary } from "@/lib/data/finance";
import { listSubscriptions } from "@/lib/data/subscriptions";
import { listTasks } from "@/lib/data/tasks";
import { forecastBalance } from "@/lib/learning/forecast";
import { monthlyCost } from "@/lib/learning/subscriptions";
import { daysUntil, money, PERIOD_LABEL, shortDate } from "@/lib/ui/format";
import { ForecastChart } from "./_components/charts";

export default async function Dashboard() {
  const { supabase } = await requireUser();
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);

  const [balance, summary, subs, tasks, recent] = await Promise.all([
    getTotalBalance(supabase),
    monthSummary(supabase, today.slice(0, 7)),
    listSubscriptions(supabase, ["active", "suggested"]),
    listTasks(supabase, ["todo", "doing"]),
    listTransactions(supabase, { from: since.toISOString().slice(0, 10), limit: 5000 }),
  ]);

  const active = subs.filter((s) => s.status === "active");
  const suggested = subs.filter((s) => s.status === "suggested");
  const upcoming = active.filter((s) => (daysUntil(s.next_due) ?? 99) <= 30).slice(0, 6);
  const subsMonthly = active.reduce((s, x) => s + monthlyCost(x.amount, x.period), 0);
  const dueTasks = tasks.filter((t) => !t.due_date || t.due_date <= today).slice(0, 6);
  const forecast = forecastBalance({
    today,
    balance,
    horizonDays: 30,
    subscriptions: active.map((s) => ({ merchant: s.merchant, amount: s.amount, period: s.period, nextDue: s.next_due })),
    recentTransactions: recent.map((t) => ({ bookedAt: t.booked_at, amount: t.amount, merchant: t.merchant })),
  });
  const maxCat = summary.byCategory[0]?.total ?? 1;
  const empty = recent.length === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
          <p className="text-sm text-ink-2">
            {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <Link href="/agents" className="btn-primary">Demander à un agent</Link>
      </header>

      {empty && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-accent bg-accent-soft">
          <p className="text-sm">Commence par importer un relevé bancaire : les agents ont besoin d&apos;historique pour apprendre.</p>
          <Link href="/import" className="btn-primary">Importer un relevé</Link>
        </div>
      )}

      {suggested.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-warn bg-warn-soft">
          <p className="text-sm">
            {suggested.length} abonnement{suggested.length > 1 ? "s" : ""} détecté{suggested.length > 1 ? "s" : ""} automatiquement, à confirmer.
          </p>
          <Link href="/subscriptions" className="btn-ghost btn-sm">Vérifier</Link>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solde total" value={money(balance)} />
        <Stat label="Revenus du mois" value={money(summary.income)} tone="pos" />
        <Stat label="Dépenses du mois" value={money(summary.expenses)} tone="neg" />
        <Stat label="Abonnements / mois" value={money(subsMonthly)} hint={`${active.length} actifs`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="card-title">Solde projeté — 30 jours</h2>
            <span className="text-xs text-ink-3">
              tendance <span className="num">{money(forecast.variableDaily)}</span>/jour
            </span>
          </div>
          <ForecastChart points={forecast.points} />
        </div>
        <div className="card">
          <h2 className="card-title">Dépenses par catégorie</h2>
          {summary.byCategory.length === 0 ? (
            <p className="text-sm text-ink-3">Aucune dépense ce mois-ci.</p>
          ) : (
            <ul className="space-y-2.5">
              {summary.byCategory.slice(0, 7).map((c) => (
                <li key={c.name}>
                  <div className="flex justify-between text-sm">
                    <span>{c.name}</span>
                    <span className="num text-ink-2">{money(c.total)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                    <div className="h-1.5 rounded-full" style={{ width: `${(c.total / maxCat) * 100}%`, background: c.color }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="flex items-baseline justify-between">
            <h2 className="card-title">Prochains prélèvements</h2>
            <Link href="/subscriptions" className="text-xs text-accent">Tout voir</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-ink-3">Rien dans les 30 prochains jours.</p>
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {s.name} <span className="text-ink-3">/ {PERIOD_LABEL[s.period]}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-ink-3">{shortDate(s.next_due)}</span>
                    <span className="num">{money(s.amount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="flex items-baseline justify-between">
            <h2 className="card-title">Tâches du jour et en retard</h2>
            <Link href="/tasks" className="text-xs text-accent">Tout voir</Link>
          </div>
          {dueTasks.length === 0 ? (
            <p className="text-sm text-ink-3">Rien d&apos;urgent.</p>
          ) : (
            <ul className="divide-y divide-line">
              {dueTasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{t.title}</span>
                  <span className={`text-xs ${t.due_date && t.due_date < today ? "text-neg" : "text-ink-3"}`}>
                    {t.due_date ? shortDate(t.due_date) : "sans date"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: "pos" | "neg"; hint?: string }) {
  return (
    <div className="card">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`num mt-1 text-xl font-semibold ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : ""}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}
