import { addPeriod, type Period } from "./subscriptions";

// Prévision de solde : abonnements actifs (dates connues) + tendance des flux variables
// (moyenne journalière des 90 derniers jours, hors abonnements).

export type ForecastInput = {
  today: string;
  balance: number;
  horizonDays: number;
  subscriptions: { merchant: string; amount: number; period: Period; nextDue: string | null }[];
  recentTransactions: { bookedAt: string; amount: number; merchant: string }[];
  windowDays?: number;
};

export type ForecastPoint = { date: string; balance: number };

export function forecastBalance(input: ForecastInput): {
  points: ForecastPoint[];
  variableDaily: number;
  subscriptionsTotal: number;
} {
  const windowDays = input.windowDays ?? 90;
  const subMerchants = new Set(input.subscriptions.map((s) => s.merchant));
  const windowStart = shift(input.today, -windowDays);

  const variable = input.recentTransactions
    .filter((t) => t.bookedAt > windowStart && t.bookedAt <= input.today && !subMerchants.has(t.merchant))
    .reduce((sum, t) => sum + t.amount, 0);

  // Moins de 30 jours d'historique : on divise par la durée réellement couverte.
  const firstDate = input.recentTransactions.map((t) => t.bookedAt).filter((d) => d > windowStart).sort()[0];
  const coveredDays = firstDate ? Math.max(30, daysBetween(firstDate, input.today) + 1) : windowDays;
  const variableDaily = variable / Math.min(windowDays, coveredDays);

  const end = shift(input.today, input.horizonDays);
  const charges = new Map<string, number>();
  let subscriptionsTotal = 0;
  for (const sub of input.subscriptions) {
    if (!sub.nextDue) continue;
    let due = sub.nextDue;
    while (due < input.today) due = addPeriod(due, sub.period);
    while (due <= end) {
      charges.set(due, (charges.get(due) ?? 0) + sub.amount);
      subscriptionsTotal += sub.amount;
      due = addPeriod(due, sub.period);
    }
  }

  const points: ForecastPoint[] = [];
  let balance = input.balance;
  for (let i = 0; i <= input.horizonDays; i++) {
    const date = shift(input.today, i);
    if (i > 0) balance += variableDaily;
    balance -= charges.get(date) ?? 0;
    points.push({ date, balance: Math.round(balance * 100) / 100 });
  }

  return {
    points,
    variableDaily: Math.round(variableDaily * 100) / 100,
    subscriptionsTotal: Math.round(subscriptionsTotal * 100) / 100,
  };
}

function shift(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
