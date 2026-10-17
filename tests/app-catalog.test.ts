import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const nango = vi.hoisted(() => ({ providers: vi.fn(), integrations: vi.fn(), configured: vi.fn() }));
vi.mock("@/lib/integrations/nango", () => ({
  getNangoProviders: nango.providers,
  getNangoIntegrations: nango.integrations,
  isNangoConfigured: nango.configured,
}));

import { catalogCategory, isOAuthMode, LOCAL_APPS } from "@/lib/app-catalog";

const provider = (name: string, auth_mode = "OAUTH2", categories = ["dev-tools"], display_name = name) => ({ name, auth_mode, categories, display_name });

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NANGO_SECRET_KEY", "server-test-key");
  nango.configured.mockReturnValue(true);
  nango.providers.mockResolvedValue([]);
  nango.integrations.mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("catalogue des applications", () => {
  it("propose des raccourcis sans clé serveur et ne contacte pas Nango", async () => {
    nango.configured.mockReturnValue(false);
    const { getAppCatalog } = await import("@/lib/integrations/app-catalog");
    const result = await getAppCatalog();
    expect(result).toMatchObject({ configured: false, source: "local", warning: expect.any(String) });
    expect(result.apps).toHaveLength(LOCAL_APPS.length);
    expect(result.apps.every((app) => app.source === "local" && app.integrations.length === 0)).toBe(true);
    expect(nango.providers).not.toHaveBeenCalled();
    expect(nango.integrations).not.toHaveBeenCalled();
  });

  it("ne rend connectables que les services OAuth disposant d'une intégration configurée", async () => {
    nango.providers.mockResolvedValue([
      provider("github", "OAUTH2", ["dev-tools"], "GitHub"),
      provider("oauth1-service", "OAUTH1"),
      provider("no-integration"),
      provider("api-key-service", "API_KEY"),
      provider("client-credentials", "OAUTH2_CC"),
      provider("unrelated-oauth"),
    ]);
    nango.integrations.mockResolvedValue([
      { unique_key: "github-work", provider: "github", display_name: "GitHub travail" },
      { unique_key: "github-personal", provider: "github" },
      { unique_key: "oauth1", provider: "oauth1-service" },
      { unique_key: "api-key", provider: "api-key-service" },
      { unique_key: "machine", provider: "client-credentials" },
      { unique_key: "other", provider: "unknown-provider" },
    ]);
    const { getAppCatalog } = await import("@/lib/integrations/app-catalog");
    const result = await getAppCatalog();
    expect(result).toMatchObject({ configured: true, source: "nango" });
    expect(result.apps.find((app) => app.id === "github")?.integrations).toEqual([
      { id: "github-work", name: "GitHub travail" }, { id: "github-personal", name: "GitHub" },
    ]);
    expect(result.apps.find((app) => app.id === "oauth1-service")?.integrations).toEqual([{ id: "oauth1", name: "oauth1-service" }]);
    for (const id of ["no-integration", "api-key-service", "client-credentials", "unrelated-oauth"]) {
      expect(result.apps.find((app) => app.id === id)?.integrations).toEqual([]);
    }
    expect(result.apps.map((app) => app.name)).toEqual(result.apps.map((app) => app.name).sort((a, b) => a.localeCompare(b, "fr")));
  });

  it("réutilise les sites connus et leurs alias sans inventer de site à partir de l'API", async () => {
    nango.providers.mockResolvedValue([
      { ...provider("gmail", "OAUTH2", [], "Gmail"), authorization_url: "https://auth.example.test/authorize", proxy: { base_url: "https://api.example.test" } },
      provider("microsoft-outlook", "OAUTH2", [], "Outlook"),
      provider("onedrive", "OAUTH2", [], "OneDrive"),
      { ...provider("unknown-service", "OAUTH2", ["crm"], "Service inconnu"), authorization_url: "https://oauth.example.test/authorize", proxy: { base_url: "https://api.example.test" }, docs: "https://docs.example.test" },
    ]);
    const { getAppCatalog } = await import("@/lib/integrations/app-catalog");
    const { apps } = await getAppCatalog();
    expect(apps.find((app) => app.id === "gmail")).toMatchObject({ url: "https://mail.google.com/", category: "communication" });
    expect(apps.find((app) => app.id === "microsoft-outlook")?.url).toBe("https://outlook.live.com/");
    expect(apps.find((app) => app.id === "onedrive")?.url).toBe("https://onedrive.live.com/");
    expect(apps.find((app) => app.id === "unknown-service")).toMatchObject({ url: null, category: "work" });
    expect(apps.filter((app) => app.id === "google-mail" || app.id === "outlook" || app.id === "one-drive")).toEqual([]);
    expect(JSON.stringify(apps)).not.toContain("api.example.test");
    expect(JSON.stringify(apps)).not.toContain("oauth.example.test");
    expect(apps.find((app) => app.id === "netflix")?.integrations).toEqual([]);
  });

  it("écarte les doublons et références dépassant les limites de l'interface", async () => {
    nango.providers.mockResolvedValue([
      provider("github", "OAUTH2", [], "GitHub"), provider("github", "OAUTH2", [], "Doublon"),
      provider("x".repeat(129)), provider("long-display", "OAUTH2", [], "x".repeat(161)),
    ]);
    nango.integrations.mockResolvedValue([{ unique_key: "x".repeat(256), provider: "github" }]);
    const { getAppCatalog } = await import("@/lib/integrations/app-catalog");
    const { apps } = await getAppCatalog();
    expect(apps.filter((app) => app.id === "github")).toHaveLength(1);
    expect(apps.find((app) => app.name === "Doublon" || app.id === "long-display" || app.id.length > 128)).toBeUndefined();
    expect(apps.find((app) => app.id === "github")?.integrations).toEqual([]);
  });

  it("partage le chargement et renouvelle le catalogue après cinq minutes", async () => {
    const time = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const { getAppCatalog } = await import("@/lib/integrations/app-catalog");
    await Promise.all([getAppCatalog(), getAppCatalog()]);
    expect(nango.providers).toHaveBeenCalledTimes(1);
    expect(nango.integrations).toHaveBeenCalledTimes(1);
    time.mockReturnValue(1_000 + 5 * 60_000);
    await getAppCatalog();
    expect(nango.providers).toHaveBeenCalledTimes(2);
  });

  it("invalide immédiatement le cache lors du changement de clé serveur", async () => {
    const { getAppCatalog } = await import("@/lib/integrations/app-catalog");
    await getAppCatalog();
    vi.stubEnv("NANGO_SECRET_KEY", "rotated-server-key");
    await getAppCatalog();
    expect(nango.providers).toHaveBeenCalledTimes(2);
    expect(nango.integrations).toHaveBeenCalledTimes(2);
  });

  it("revient aux raccourcis sans exposer l'erreur distante puis permet un nouvel essai", async () => {
    nango.providers.mockRejectedValueOnce(new Error("private-credential-marker")).mockResolvedValueOnce([provider("github")]);
    const logs = vi.spyOn(console, "error");
    const { getAppCatalog } = await import("@/lib/integrations/app-catalog");
    const fallback = await getAppCatalog();
    expect(fallback).toMatchObject({ configured: false, source: "local", warning: expect.any(String) });
    expect(JSON.stringify(fallback)).not.toContain("private-credential-marker");
    expect(logs).not.toHaveBeenCalled();
    expect(await getAppCatalog()).toMatchObject({ configured: true, source: "nango" });
    expect(nango.providers).toHaveBeenCalledTimes(2);
  });

  it("revérifie la configuration OAuth à chaque demande malgré le cache du catalogue", async () => {
    nango.providers.mockResolvedValue([provider("github")]);
    nango.integrations.mockResolvedValue([{ unique_key: "github-work", provider: "github" }]);
    const { getAppCatalog, requireOAuthIntegration } = await import("@/lib/integrations/app-catalog");
    await getAppCatalog();
    expect(await requireOAuthIntegration("github", "github-work")).toMatchObject({ name: "github" });
    nango.integrations.mockResolvedValue([]);
    await expect(requireOAuthIntegration("github", "github-work")).rejects.toThrow("connexion OAuth configurée");
    expect(nango.providers).toHaveBeenCalledTimes(3);
    expect(nango.integrations).toHaveBeenCalledTimes(3);
  });

  it.each(["API_KEY", "OAUTH2_CC", "BASIC", "NONE"])("refuse une session pour le mode %s", async (mode) => {
    nango.providers.mockResolvedValue([provider("service", mode)]);
    nango.integrations.mockResolvedValue([{ unique_key: "service-work", provider: "service" }]);
    const { requireOAuthIntegration } = await import("@/lib/integrations/app-catalog");
    await expect(requireOAuthIntegration("service", "service-work")).rejects.toThrow("connexion OAuth configurée");
  });
});

describe("catégories et modes OAuth du catalogue", () => {
  it.each([
    [["accounting"], "banking"], [["email"], "communication"], [["e-commerce"], "shopping"],
    [["music"], "entertainment"], [["dev-tools"], "work"], [["unknown-category"], "other"],
  ] as const)("classe %j dans %s", (categories, expected) => { expect(catalogCategory([...categories])).toBe(expected); });

  it("limite OAuth aux flux d'autorisation d'un utilisateur", () => {
    expect(isOAuthMode("OAUTH1")).toBe(true);
    expect(isOAuthMode("OAUTH2")).toBe(true);
    expect(isOAuthMode("OAUTH2_CC")).toBe(false);
    expect(isOAuthMode("API_KEY")).toBe(false);
  });
});
