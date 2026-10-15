// Espaces perso/pro (ticket #1) : partagé entre serveur, navigateur et tests.

export type Space = "perso" | "pro";
export type SpaceFilter = Space | "all";

export const SPACE_COOKIE = "kb_space";
export const SPACE_LABEL: Record<SpaceFilter, string> = { all: "Tout", perso: "Perso", pro: "Pro" };

export function parseSpaceFilter(value: string | null | undefined): SpaceFilter {
  return value === "perso" || value === "pro" ? value : "all";
}

// Espace utilisé pour créer un élément : l'espace actif, ou perso quand le filtre est « Tout ».
export function defaultSpace(filter: SpaceFilter): Space {
  return filter === "all" ? "perso" : filter;
}

export function isSpace(value: unknown): value is Space {
  return value === "perso" || value === "pro";
}
