const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

export function money(value: number, currency = "EUR") {
  if (currency === "EUR") return eur.format(value);
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(value);
}

export function shortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function daysUntil(iso: string | null | undefined) {
  if (!iso) return null;
  const today = new Date().toISOString().slice(0, 10);
  return Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);
}

export const PERIOD_LABEL = { weekly: "semaine", monthly: "mois", quarterly: "trimestre", yearly: "an" } as const;
export const PRIORITY_LABEL = { low: "Basse", medium: "Moyenne", high: "Haute" } as const;
export const STATUS_LABEL = { todo: "À faire", doing: "En cours", done: "Terminé" } as const;
