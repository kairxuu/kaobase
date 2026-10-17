import "server-only";
import { createHash } from "node:crypto";
import { LOCAL_APPS, catalogCategory, isOAuthMode, type CatalogResult } from "@/lib/app-catalog";
import { UserError } from "@/lib/errors";
import { getNangoIntegrations, getNangoProviders, isNangoConfigured } from "./nango";

const ALIASES: Record<string, string> = { gmail: "google-mail", "microsoft-outlook": "outlook", onedrive: "one-drive", "microsoft-onedrive": "one-drive" };
const TTL = 5 * 60_000;
let cache: { key: string; until: number; value: Promise<CatalogResult> } | undefined;

export function localCatalog(warning = "Une sélection de raccourcis est disponible. Le catalogue en ligne et les connexions de comptes seront proposés après leur activation."): CatalogResult {
  return { apps: LOCAL_APPS.map((app) => ({ ...app, integrations: [] })), configured: false, source: "local", warning };
}

async function loadCatalog(): Promise<CatalogResult> {
  const [providers, integrations] = await Promise.all([getNangoProviders(), getNangoIntegrations()]);
  const seen = new Set<string>();
  const apps = providers.filter((provider) => {
    if (provider.name.length > 128 || provider.display_name.length > 160 || seen.has(provider.name)) return false;
    seen.add(provider.name);
    return true;
  }).map((provider) => {
    const preset = LOCAL_APPS.find((app) => app.id === (ALIASES[provider.name] ?? provider.name));
    return {
      id: provider.name, name: provider.display_name,
      description: preset?.description ?? "Service du catalogue Nango",
      category: preset?.category ?? catalogCategory(provider.categories), url: preset?.url ?? null,
      authMode: provider.auth_mode,
      integrations: isOAuthMode(provider.auth_mode) ? integrations
        .filter((item) => item.provider === provider.name && item.unique_key.length <= 255)
        .map((item) => ({ id: item.unique_key, name: item.display_name ?? provider.display_name })) : [],
      source: "nango" as const,
    };
  });
  // Keep useful link-only apps even if the provider has no OAuth/API integration.
  const liveIds = new Set(apps.map((app) => ALIASES[app.id] ?? app.id));
  return {
    apps: [...apps, ...LOCAL_APPS.filter((app) => !liveIds.has(app.id))].sort((a, b) => a.name.localeCompare(b.name, "fr")),
    configured: true, source: "nango",
  };
}

export async function getAppCatalog(): Promise<CatalogResult> {
  if (!isNangoConfigured()) return localCatalog();
  const key = createHash("sha256").update(process.env.NANGO_SECRET_KEY!.trim()).digest("hex");
  if (!cache || cache.key !== key || cache.until <= Date.now()) {
    cache = { key, until: Date.now() + TTL, value: loadCatalog() };
  }
  try { return await cache.value; }
  catch {
    cache = undefined;
    return localCatalog("Le catalogue en ligne est momentanément indisponible. Les raccourcis restent utilisables ; réessaie pour connecter un service.");
  }
}

// Re-read configuration before a new session or callback. A cached catalog is only
// for browsing; removing an integration must immediately prevent new associations.
export async function requireOAuthIntegration(providerId: string, integrationId: string) {
  const [providers, integrations] = await Promise.all([getNangoProviders(), getNangoIntegrations()]);
  const provider = providers.find((item) => item.name === providerId);
  if (!provider || !isOAuthMode(provider.auth_mode) || !integrations.some((item) => item.unique_key === integrationId && item.provider === providerId)) {
    throw new UserError("Cette app ne dispose pas d'une connexion OAuth configurée. Ajoute un raccourci ou choisis un autre service.");
  }
  return provider;
}
