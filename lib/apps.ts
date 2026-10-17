import { z } from "zod";
import { UserError } from "./errors";

export const APP_CATEGORIES = [
  { id: "banking", label: "Banque & finances" },
  { id: "work", label: "Travail & organisation" },
  { id: "communication", label: "Communication" },
  { id: "shopping", label: "Achats" },
  { id: "entertainment", label: "Loisirs & abonnements" },
  { id: "other", label: "Autres" },
] as const;

export type AppCategory = (typeof APP_CATEGORIES)[number]["id"];
export type AppShortcut = {
  id: string;
  name: string;
  url: string;
  account_label: string;
  category: AppCategory;
  space: "perso" | "pro";
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export function normalizeAppUrl(value: string): string {
  const input = value.trim();
  if (!input || input.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(input)) {
    throw new UserError("Saisis un lien valide sans espace, par exemple https://mon-app.com.");
  }
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 2048) throw new Error();
    return url.href;
  } catch {
    throw new UserError("Utilise un lien HTTP ou HTTPS, sans identifiant ni mot de passe dans l'adresse.");
  }
}

const schema = z.object({
  name: z.string().trim().min(1, "Indique le nom de l'app.").max(80, "Le nom ne peut pas dépasser 80 caractères.").refine((v) => !/[\u0000-\u001f\u007f-\u009f]/.test(v), "Le nom ne doit pas contenir de caractères de contrôle."),
  url: z.string(),
  accountLabel: z.string().trim().max(160, "L'identifiant ne peut pas dépasser 160 caractères.").refine((v) => !/[\u0000-\u001f\u007f-\u009f]/.test(v), "L'identifiant ne doit pas contenir de caractères de contrôle."),
  category: z.enum(APP_CATEGORIES.map((c) => c.id) as [AppCategory, ...AppCategory[]], { error: "Choisis une catégorie proposée." }),
  space: z.enum(["perso", "pro"], { error: "Choisis l'espace personnel ou professionnel." }),
  pinned: z.boolean(),
});

export function parseAppForm(formData: FormData, defaultSpace: "perso" | "pro" = "perso") {
  const parsed = schema.safeParse({
    name: formData.get("name"), url: formData.get("url"), accountLabel: formData.get("accountLabel") ?? "",
    category: formData.get("category") ?? "other", space: formData.get("space") ?? defaultSpace,
    pinned: formData.get("pinned") === "on" || formData.get("pinned") === "true",
  });
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "Vérifie les informations de l'app.");
  return { ...parsed.data, url: normalizeAppUrl(parsed.data.url) };
}

export function appHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}
