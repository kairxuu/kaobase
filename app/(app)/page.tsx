import Link from "next/link";
import "./dashboard.css";
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
import { AppShortcuts } from "./_components/app-shortcuts";
import { listAppShortcuts } from "@/lib/data/apps";

export default async function Dashboard() {
  const { db, userId } = await requireUser();
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
  const accountIds = await accountIdsFor(db, space);
  const [balance, recent, categories, subs, tasks, { data: profile }, budgets, apps] = await Promise.all([
    getTotalBalance(db, space),
    listTransactions(db, { from: since.toISOString().slice(0, 10), limit: 5000, accountIds }),
    getCategories(db),
    listSubscriptions(db, ["active", "suggested"], space),
    listTasks(db, ["todo", "doing"], space),
    db.from("profiles").select("display_name").eq("id", userId).single(),
    listBudgets(db).catch(() => null),
    listAppShortcuts(db, space, { pinnedOnly: true, limit: 8 }).catch((error) => {
      console.error("[kaobase] raccourcis apps :", error);
      return null;
    }),
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
    subscriptions: active.map((s) => ({ merchant: s.merchant, amount: s.amount, period: s.period, nextDue: s.next_due, anchorDay: s.anchor_day })),
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
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-date">{now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</p>
          <h1 className="page-title">{firstName ? `Bonjour ${firstName}` : "Bonjour"}</h1>
        </div>
        <div className="dashboard-actions">
          <Link href="/agents" className="btn-ghost">Poser une question</Link>
          <Link href="/import" className="btn-primary">Importer un relevé <span aria-hidden>↗</span></Link>
        </div>
      </header>

      <section aria-label="Résumé des comptes">
        <dl className="dashboard-metrics">
          <div className="dashboard-metric dashboard-balance">
            <dt>Solde des comptes</dt>
            <dd className="figure">{money(balance)}<span className="dashboard-metric-note">Tous les comptes de l’espace affiché</span></dd>
          </div>
          <div className="dashboard-metric">
            <dt>Entrées du mois <span aria-hidden>↙</span></dt>
            <dd className="figure text-pos">{money(summary.income)}<span className="dashboard-metric-note">{now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</span></dd>
          </div>
          <div className="dashboard-metric">
            <dt>Dépenses du mois <span aria-hidden>↗</span></dt>
            <dd className="figure">{money(summary.expenses)}<span className="dashboard-metric-note">D’après les opérations importées</span></dd>
          </div>
        </dl>
      </section>

      {suggested.length > 0 && (
        <div className="dashboard-notice">
          <p>{suggested.length === 1 ? "Un abonnement à vérifier" : `${suggested.length} abonnements à vérifier`} <span className="text-ink-2">· paiements récurrents repérés dans tes opérations</span></p>
          <Link href="/subscriptions" className="dashboard-link">Vérifier <span aria-hidden>→</span></Link>
        </div>
      )}

      <div className="dashboard-columns">
        <div className="dashboard-stack">
          <section className="dashboard-panel" aria-labelledby="forecast-title">
            <div className="dashboard-panel-heading">
              <div><h2 id="forecast-title">Prévision du solde</h2><p>Les 30 prochains jours · estimation</p></div>
              <span className="dashboard-period">30 J</span>
            </div>
            {recent.length > 0 ? (
              <>
                <ForecastLine points={forecast.points} currency={currency} />
                <p className="dashboard-footnote">Abonnements connus et dépenses habituelles estimées à {money(forecast.variableDaily)} par jour.</p>
              </>
            ) : (
              <div className="dashboard-empty">
                <p className="font-display text-2xl">Commence par un relevé.</p>
                <p>Importe un fichier CSV ou OFX de ta banque pour afficher tes dépenses et estimer ton solde à venir.</p>
                <Link href="/import" className="dashboard-link">Importer mon premier relevé <span aria-hidden>→</span></Link>
              </div>
            )}
          </section>

          <section className="dashboard-panel" aria-labelledby="categories-title">
            <div className="dashboard-panel-heading">
              <h2 id="categories-title">Dépenses par catégorie</h2>
              <Link href={`/transactions?mois=${month}`} className="dashboard-link">Opérations <span aria-hidden>↗</span></Link>
            </div>
            {topCategories.length === 0 ? (
              <p className="dashboard-muted">Aucune dépense enregistrée ce mois-ci.</p>
            ) : (
              <ul className="dashboard-categories">
                {topCategories.map((c) => (
                  <li key={c.categoryId ?? c.name}>
                    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
                      <Link href={c.categoryId ? `/transactions?mois=${month}&categorie=${c.categoryId}` : `/transactions?mois=${month}&non=1`} className="hover:text-accent">{c.name}</Link>
                      <span className={`num ${c.limit && c.total > c.limit ? "text-neg" : "text-ink-2"}`}>
                        {money(c.total)}{c.limit && <span className="text-ink-3"> / {money(c.limit)}</span>}
                      </span>
                    </div>
                    <div className="relative mt-2 h-1 bg-surface-2">
                      <div className="h-1" style={{ width: `${(c.total / maxCat) * 100}%`, background: c.color }} />
                      {c.limit && <span className="absolute -top-1 h-3 w-px bg-ink" style={{ left: `${(c.limit / maxCat) * 100}%` }} title={`Budget : ${money(c.limit)}`} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="dashboard-stack">
          <section className="dashboard-panel" aria-labelledby="payments-title">
            <div className="dashboard-panel-heading"><h2 id="payments-title">À prélever</h2><Link href="/subscriptions" className="dashboard-link" aria-label="Voir tous les abonnements">Tout voir ↗</Link></div>
            <p className="dashboard-payment-total figure">{money(remaining)}</p>
            <p className="dashboard-muted mb-4">restants sur les abonnements de ce mois</p>
            {upcoming.length === 0 ? (
              <p className="dashboard-muted">Aucun prélèvement prévu dans les 30 jours.</p>
            ) : (
              <ul className="dashboard-rows">
                {upcoming.map((s) => (
                  <li key={s.id}>
                    <div className="min-w-0"><span className="block truncate">{s.name}</span><span className="dashboard-muted">{shortDate(s.next_due)}</span></div>
                    <span className="num shrink-0">{money(s.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <details className="dashboard-calendar">
              <summary>Calendrier du mois</summary>
              <MonthDial currency={currency} today={now.getUTCDate()} daysInMonth={daysInMonth} marks={marks} remaining={remaining} total={totalThisMonth} />
            </details>
          </section>

          <section className="dashboard-panel" aria-labelledby="tasks-title">
            <div className="dashboard-panel-heading"><h2 id="tasks-title">À faire aujourd’hui</h2><Link href="/tasks" className="dashboard-link" aria-label="Voir toutes les tâches">Tout voir ↗</Link></div>
            {dueTasks.length === 0 ? (
              <p className="dashboard-muted">Aucune tâche en retard ou prévue aujourd’hui.</p>
            ) : (
              <ul className="dashboard-rows">
                {dueTasks.map((t) => (
                  <li key={t.id}>
                    <Link href="/tasks" className="min-w-0 hover:text-accent">{t.title}</Link>
                    <span className={`shrink-0 text-xs ${t.due_date && t.due_date < today ? "text-neg" : "text-ink-3"}`}>
                      {t.due_date ? (t.due_date < today ? shortDate(t.due_date) + " · en retard" : "aujourd’hui") : "sans date"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <AppShortcuts apps={apps} showSpace={space === "all"} />
    </div>
  );
}
