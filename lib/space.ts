import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { DatabaseClient } from "@/lib/database/server";
import { parseSpaceFilter, SPACE_COOKIE, type SpaceFilter } from "./space-shared";

export * from "./space-shared";

// Filtre d'espace choisi dans la barre latérale (cookie, « Tout » par défaut).
export const getSpaceFilter = cache(async (): Promise<SpaceFilter> => {
  return parseSpaceFilter((await cookies()).get(SPACE_COOKIE)?.value);
});

// Comptes de l'espace : les opérations héritent de l'espace de leur compte.
// undefined = pas de filtre (« Tout ») ; [] = aucun compte dans cet espace.
export async function accountIdsFor(db: DatabaseClient, filter: SpaceFilter): Promise<string[] | undefined> {
  if (filter === "all") return undefined;
  const { data, error } = await db.from("accounts").select("id").eq("space", filter);
  if (error) throw error;
  return (data ?? []).map((a) => a.id as string);
}
