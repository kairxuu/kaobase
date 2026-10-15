// Détection d'abonnements récurrents à partir de l'historique de transactions.
// Algorithme déterministe (aucun appel IA) :
//   1. regrouper les dépenses par marchand normalisé ;
//   2. mesurer les écarts entre dates et les rapprocher d'une période connue ;
//   3. mesurer la stabilité des montants ;
//   4. combiner en un score de confiance.

export type Period = "weekly" | "monthly" | "quarterly" | "yearly";

export const PERIOD_DAYS: Record<Period, number> = {
  weekly: 7,
  monthly: 30.44,
  quarterly: 91.31,
  yearly: 365.25,
};

const PERIOD_TOLERANCE: Record<Period, number> = {
  weekly: 2,
  monthly: 5,
  quarterly: 10,
  yearly: 20,
};

const MIN_OCCURRENCES: Record<Period, number> = {
  weekly: 4,
  monthly: 3,
  quarterly: 2,
  yearly: 2,
};

export type TxForDetection = { bookedAt: string; amount: number; merchant: string };

export type SubscriptionCandidate = {
  merchant: string;
  period: Period;
  amount: number; // coût positif par période (montant le plus récent)
  occurrences: number;
  lastDate: string;
  nextDue: string;
  confidence: number; // 0..1
};

const DAY_MS = 86_400_000;

function toDay(iso: string): number {
  return Math.round(Date.parse(iso + "T00:00:00Z") / DAY_MS);
}

function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function addPeriod(iso: string, period: Period, times = 1): string {
  const d = new Date(iso + "T00:00:00Z");
  if (period === "weekly") d.setUTCDate(d.getUTCDate() + 7 * times);
  else {
    const months = (period === "monthly" ? 1 : period === "quarterly" ? 3 : 12) * times;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
  }
  return d.toISOString().slice(0, 10);
}

// Prochaine échéance à partir d'aujourd'hui, sans rien écrire.
export function rollForward(nextDue: string | null, period: Period, today: string): string | null {
  if (!nextDue) return null;
  let due = nextDue;
  while (due < today) due = addPeriod(due, period);
  return due;
}

function classifyPeriod(gap: number): Period | null {
  for (const p of Object.keys(PERIOD_DAYS) as Period[]) {
    if (Math.abs(gap - PERIOD_DAYS[p]) <= PERIOD_TOLERANCE[p]) return p;
  }
  return null;
}

export function detectSubscriptions(
  transactions: TxForDetection[],
  options: { today?: string; minConfidence?: number; exclude?: Set<string> } = {},
): SubscriptionCandidate[] {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const minConfidence = options.minConfidence ?? 0.6;
  const groups = new Map<string, TxForDetection[]>();

  for (const tx of transactions) {
    if (tx.amount >= 0 || options.exclude?.has(tx.merchant)) continue;
    const list = groups.get(tx.merchant) ?? [];
    list.push(tx);
    groups.set(tx.merchant, list);
  }

  const candidates: SubscriptionCandidate[] = [];

  for (const [merchant, txs] of groups) {
    if (txs.length < 2) continue;
    // Un seul paiement par jour : les doublons du même jour faussent les écarts.
    const byDay = new Map<number, TxForDetection>();
    for (const tx of txs) byDay.set(toDay(tx.bookedAt), tx);
    const days = [...byDay.keys()].sort((a, b) => a - b);
    if (days.length < 2) continue;

    const gaps = days.slice(1).map((d, i) => d - days[i]);
    const period = classifyPeriod(median(gaps));
    if (!period || days.length < MIN_OCCURRENCES[period]) continue;

    const expected = PERIOD_DAYS[period];
    const tolerance = PERIOD_TOLERANCE[period];
    const regularGaps = gaps.filter((g) => Math.abs(g - expected) <= tolerance).length;
    const gapScore = regularGaps / gaps.length;

    const amounts = days.map((d) => Math.abs(byDay.get(d)!.amount));
    const ref = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - ref) <= Math.max(1, ref * 0.05)).length;
    const amountScore = stable / amounts.length;

    const volumeScore = Math.min(1, days.length / 6);

    // Abonnement « mort » : aucun paiement depuis plus de 2 périodes -> pénalité.
    const lastDay = days[days.length - 1];
    const silentPeriods = (toDay(today) - lastDay) / expected;
    const recencyPenalty = silentPeriods > 2 ? 0.5 : 1;

    const confidence =
      Math.round((0.5 * gapScore + 0.3 * amountScore + 0.2 * volumeScore) * recencyPenalty * 100) / 100;
    if (confidence < minConfidence) continue;

    const lastDate = fromDay(lastDay);
    let nextDue = addPeriod(lastDate, period);
    while (nextDue < today) nextDue = addPeriod(nextDue, period);

    candidates.push({
      merchant,
      period,
      amount: amounts[amounts.length - 1],
      occurrences: days.length,
      lastDate,
      nextDue,
      confidence,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

// Nombre de périodes par an : exact pour les périodes calendaires (12 mois = 12 paiements).
const PER_YEAR: Record<Period, number> = { weekly: 365.25 / 7, monthly: 12, quarterly: 4, yearly: 1 };

export function annualCost(amount: number, period: Period): number {
  return Math.round(amount * PER_YEAR[period] * 100) / 100;
}

export function monthlyCost(amount: number, period: Period): number {
  return Math.round(((amount * PER_YEAR[period]) / 12) * 100) / 100;
}
