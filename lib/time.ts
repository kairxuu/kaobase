// Heure locale de l'utilisateur (ticket #1) : les agents raisonnent dans son fuseau, pas en UTC.

export const DEFAULT_TIMEZONE = "Europe/Paris";

export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function safeTz(tz: string | null | undefined) {
  return isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

// Date locale AAAA-MM-JJ dans le fuseau donné.
export function localDate(tz: string | null | undefined, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeTz(tz), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// « jeudi 15 octobre 2026, 21 h 40 (Europe/Paris) » pour le prompt des agents.
export function formatNowForPrompt(tz: string | null | undefined, now: Date = new Date()): string {
  const zone = safeTz(tz);
  const day = new Intl.DateTimeFormat("fr-FR", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now).replace(":", " h ");
  return `${day}, ${time} (${zone})`;
}
