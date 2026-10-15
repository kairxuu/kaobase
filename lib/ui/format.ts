const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string) {
  let f = formatters.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat("fr-FR", { style: "currency", currency });
    } catch {
      // Code devise invalide en base : on retombe sur l'euro plutôt que de casser la page.
      f = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
    }
    formatters.set(currency, f);
  }
  return f;
}

export function money(value: number, currency = "EUR") {
  return formatter(currency).format(value);
}

// Formateur lié à la devise du profil (réglage « Devise »), à créer une fois par page.
export function moneyIn(currency: string | null | undefined) {
  const f = formatter((currency || "EUR").toUpperCase());
  return (value: number) => f.format(value);
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
