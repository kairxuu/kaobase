import Link from "next/link";
import { getCurrency, requireUser } from "@/lib/auth";
import { accountIdsFor, getSpaceFilter } from "@/lib/space";
import { getCategories, getTotalBalance, listTransactions, summarizeMonth } from "@/lib/data/finance";
import { listSubscriptions } from "@/lib/data/subscriptions";
import { listTasks } from "@/lib/data/tasks";
import { listBudgets } from "@/lib/data/budgets";
import { forecastBalance } from "@/lib/learning/forecast";
import { daysUntil, moneyIn, shortDate } from "@/lib/ui/format";
import { MonthDial, type DialMark } from "./_components/month-dial";
import { ForecastLine } from "./_components/forecast-line";

export default async function Dashboard() {
  const { supabase, userId } = await requireUser();
  const currency = await getCurrency();
  const money = moneyIn(currency);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - 90);

  // Une seule lecture des 90 derniers jours sert au mois en cours, au cadran et à la prévision.
  // Espace actif (ticket #1) : solde, mois, cadran, prévision, prélèvements et tâches filtrés.
  const space = await getSpaceFilter();
  const accountIds = await accountIdsFor(supabase, space);
  const [balance, recent, categories, subs, tasks, { data: profile }, budgets] = await Promise.all([
    getTotalBalance(supabase, space),
    listTransactions(supabase, { from: since.toISOString().slice(0, 10), limit: 5000, accountIds }),
    getCategories(supabase),
    listSubscriptions(supabase, ["active", "suggested"], space),
    listTasks(supabase, ["todo", "doing"], space),
    supabase.from("profiles").select("display_name").eq("id", userId).single(),
    listBudgets(supabase).catch(() => null),
  ]);

  const summary = summarizeMonth(recent, categories, month);
  const active = subs.filter((s) => s.status === "active");
  const suggested = subs.filter((s) => s.status === "suggested");

  // Cadran : prélèvements déjà passés ce mois (vus dans les opérations) et ceux à venir.
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const byMerchant = new Map(active.map((s) => [s.merchant, s]));
  const marks: DialMark[] = [];
  const paidMerchants = new Set<string>();
  for (const t of recent) {
    const sub = byMerchant.get(t.merchant);
    if (sub && t.amount < 0 && t.booked_at.startsWith(month) && !paidMerchants.has(t.merchant)) {
      paidMerchants.add(t.merchant);
      marks.push({ day: Number(t.booked_at.slice(8, 10)), label: sub.name, amount: -t.amount, paid: true });
    }
  }
  for (const s of active) {
    if (s.next_due?.startsWith(month) && !paidMerchants.has(s.merchant)) {
      marks.push({ day: Number(s.next_due.slice(8, 10)), label: s.name, amount: s.amount, paid: false });
    }
  }
  const remaining = marks.filter((m) => !m.paid).reduce((a, m) => a + m.amount, 0);
  const totalThisMonth = marks.reduce((a, m) => a + m.amount, 0);

  const upcoming = active.filter((s) => (daysUntil(s.next_due) ?? 99) <= 30).slice(0, 5);
  const dueTasks = tasks.filter((t) => !t.due_date || t.due_date <= today).slice(0, 5);
  const forecast = forecastBalance({
    today,
    balance,
    horizonDays: 30,
    subscriptions: active.map((s) => ({ merchant: s.merchant, amount: s.amount, period: s.period, nextDue: s.next_due })),
    recentTransactions: recent.map((t) => ({ bookedAt: t.booked_at, amount: t.amount, merchant: t.merchant })),
  });
  // Catégories budgétées toujours visibles, même sans dépense ce mois-ci.
  const limitOf = new Map((budgets ?? []).map((b) => [b.category_id, b.monthly_limit]));
  const shown = summary.byCategory.slice(0, 6);
  for (const id of limitOf.keys()) {
    if (!shown.some((c) => c.categoryId === id)) {
      const c = categories.find((x) => x.id === id);
      if (c) shown.push({ categoryId: id, name: c.name, color: c.color, total: 0 });
    }
  }
  const topCategories = shown.map((c) => ({ ...c, limit: c.categoryId ? limitOf.get(c.categoryId) : undefined }));
  const maxCat = Math.max(1, ...topCategories.map((c) => Math.max(c.total, c.limit ?? 0)));
  const firstName = profile?.display_name?.split(" ")[0];

  return (
    <div className="space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">{firstName ? `Bonjour ${firstName}` : "Bonjour"}</h1>
          <p className="page-lede">
            {now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}, jour {now.getUTCDate()} sur {daysInMonth}.
          </p>
        </div>
        <Link href="/agents" className="btn-primary">Poser une question</Link>
      </header>

      {recent.length === 0 && (
        <div className="slip flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Aucune opération pour l&apos;instant. Importe un relevé de ta banque : le cadran, la prévision et les agents se rempliront.
          </p>
          <Link href="/import" className="btn-primary">Importer un relevé</Link>
        </div>
      )}

      {suggested.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-warn-soft px-4 py-3">
          <p className="text-sm">
            {suggested.length === 1
              ? "Un paiement revient chaque mois sans être suivi comme abonnement."
              : `${suggested.length} paiements reviennent régulièrement sans être suivis comme abonnements.`}
          </p>
          <Link href="/subscriptions" className="btn-ghost btn-sm">Les vérifier</Link>
        </div>
      )}

      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <MonthDial currency={currency} today={now.getUTCDate()} daysInMonth={daysInMonth} marks={marks} remaining={remaining} total={totalThisMonth} />

        <div className="space-y-8">
          <div>
            <p className="text-sm text-ink-2">Sur tes comptes</p>
            <p className="figure mt-1 text-5xl md:text-6xl">{money(balance)}</p>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 border-t border-line pt-4 text-sm">
            <div>
              <dt className="text-ink-2">Entré ce mois</dt>
              <dd className="figure mt-1 text-2xl text-pos">{money(summary.income)}</dd>
            </div>
            <div>
              <dt className="text-ink-2">Sorti ce mois</dt>
              <dd className="figure mt-1 text-2xl text-neg">{money(summary.expenses)}</dd>
            </div>
          </dl>

          <div>
            <h2 className="section-title">Prochains prélèvements</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-ink-3">Rien de prévu dans les 30 jours.</p>
            ) : (
              <ul>
                {upcoming.map((s) => (
                  <li key={s.id} className="flex items-baseline gap-4 border-b border-line py-2 text-sm last:border-0">
                    <span className="figure w-14 shrink-0 text-ink-2">{shortDate(s.next_due)}</span>
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="num">{money(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-2xl">Ton solde sur les 30 prochains jours</h2>
            <p className="text-sm text-ink-2">
              Abonnements connus, plus ta tendance habituelle : {money(forecast.variableDaily)} par jour.
            </p>
          </div>
          <ForecastLine points={forecast.points} currency={currency} />
        </section>
      )}

      <section className="grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="section-title">Où part l&apos;argent ce mois-ci</h2>
          {topCategories.length === 0 ? (
            <p className="text-sm text-ink-3">Aucune dépense enregistrée ce mois-ci.</p>
          ) : (
            <ul className="space-y-3">
              {topCategories.map((c) => (
                <li key={c.name}>
                  <div className="flex justify-between gap-3 text-sm">
                    <Link
                      href={c.categoryId ? `/transactions?mois=${month}&categorie=${c.categoryId}` : `/transactions?mois=${month}&non=1`}
                      className="hover:text-accent"
                    >
                      {c.name}
                    </Link>
                    <span className={`num ${c.limit && c.total > c.limit ? "text-neg" : "text-ink-2"}`}>
                      {money(c.total)}
                      {c.limit && <span className="text-ink-3"> sur {money(c.limit)}</span>}
                    </span>
                  </div>
                  <div className="relative mt-1.5 h-[3px] bg-surface-2">
                    <div className="h-[3px]" style={{ width: `${(c.total / maxCat) * 100}%`, background: c.color }} />
                    {c.limit && (
                      <span
                        className="absolute -top-1 h-[11px] w-px bg-ink"
                        style={{ left: `${(c.limit / maxCat) * 100}%` }}
                        title={`Budget : ${money(c.limit)}`}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="section-title mb-0">À faire maintenant</h2>
            <Link href="/tasks" className="text-sm text-accent hover:underline">Toutes les tâches</Link>
          </div>
          {dueTasks.length === 0 ? (
            <p className="text-sm text-ink-3">Rien en retard ni prévu pour aujourd&apos;hui.</p>
          ) : (
            <ul>
              {dueTasks.map((t) => (
                <li key={t.id} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-sm last:border-0">
                  <span>{t.title}</span>
                  <span className={`shrink-0 text-xs ${t.due_date && t.due_date < today ? "text-neg" : "text-ink-3"}`}>
                    {t.due_date ? (t.due_date < today ? `en retard, ${shortDate(t.due_date)}` : "aujourd'hui") : "sans date"}
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
