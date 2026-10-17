import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(), onboarding: vi.fn(), catalog: vi.fn(), revalidate: vi.fn(),
  providers: vi.fn(), integrations: vi.fn(), session: vi.fn(), owned: vi.fn(), removeRemote: vi.fn(),
  list: vi.fn(), get: vi.fn(), complete: vi.fn(), removeLocal: vi.fn(), reserve: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getUserForApi: mocks.auth }));
vi.mock("@/lib/data/onboarding", () => ({ getOnboardingStatus: mocks.onboarding }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/integrations/app-catalog", async (original) => ({
  ...await original<typeof import("@/lib/integrations/app-catalog")>(), getAppCatalog: mocks.catalog,
}));
vi.mock("@/lib/integrations/nango", () => ({
  getNangoProviders: mocks.providers, getNangoIntegrations: mocks.integrations,
  createNangoSession: mocks.session, getOwnedNangoConnection: mocks.owned,
  deleteOwnedNangoConnection: mocks.removeRemote, isNangoConfigured: () => true,
}));
vi.mock("@/lib/data/app-connections", () => ({
  listAppConnections: mocks.list, getAppConnection: mocks.get, completeAppConnection: mocks.complete,
  deleteAppConnection: mocks.removeLocal, reserveAppConnectSession: mocks.reserve,
}));

import { UserError } from "@/lib/errors";
import { GET as catalogGET } from "@/app/api/apps/catalog/route";
import { POST as sessionPOST } from "@/app/api/apps/connect/session/route";
import { POST as completePOST } from "@/app/api/apps/connect/complete/route";
import { POST as disconnectPOST } from "@/app/api/apps/connections/[id]/disconnect/route";

const ORIGIN = "https://kaobase.example.test";
const USER = "10000000-0000-4000-8000-000000000001";
const ID = "10000000-0000-4000-8000-000000000002";
const SHORTCUT = "10000000-0000-4000-8000-000000000003";
const SECRET = "private-oauth-credential-marker";
const database = {};
const INPUT = {
  providerId: "github", integrationId: "github-work", name: "GitHub travail", url: "https://github.com/login",
  accountLabel: "me@example.test", category: "work", space: "pro", pinned: true,
};
const provider = { name: "github", display_name: "GitHub", categories: ["dev-tools"], auth_mode: "OAUTH2" };
const remoteConnection = { connectionId: "remote-owned", integrationId: INPUT.integrationId, providerId: INPUT.providerId, createdAt: "2026-10-17T10:00:00.000Z" };
const localConnection = { id: ID, shortcut_id: SHORTCUT, provider_id: "github", provider_name: "GitHub", integration_id: "github-work", connection_id: "remote-owned", connected_at: "2026-10-17T10:00:00.000Z" };

function request(path: string, data: unknown = INPUT, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/apps/${path}`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
  });
}
function completion(data: Record<string, unknown> = {}) {
  return request("connect/complete", { ...INPUT, connectionId: remoteConnection.connectionId, ...data });
}
function disconnect(req = request(`connections/${ID}/disconnect`, {}), id = ID) {
  return disconnectPOST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: USER, db: database });
  mocks.onboarding.mockResolvedValue("complete");
  mocks.catalog.mockResolvedValue({ configured: false, source: "local", apps: [] });
  mocks.providers.mockResolvedValue([provider]);
  mocks.integrations.mockResolvedValue([{ unique_key: INPUT.integrationId, provider: INPUT.providerId }]);
  mocks.session.mockResolvedValue({ token: "limited-connect-session", expiresAt: "2026-10-17T10:30:00.000Z" });
  mocks.owned.mockResolvedValue(remoteConnection);
  mocks.removeRemote.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue([]);
  mocks.get.mockResolvedValue(localConnection);
  mocks.complete.mockResolvedValue(SHORTCUT);
  mocks.removeLocal.mockResolvedValue(undefined);
  mocks.reserve.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});
afterEach(() => { vi.restoreAllMocks(); });

const endpoints = [
  { name: "catalogue", run: () => catalogGET() },
  { name: "session", run: () => sessionPOST(request("connect/session")) },
  { name: "confirmation", run: () => completePOST(completion()) },
  { name: "déconnexion", run: () => disconnect() },
];

describe("accès aux API des apps", () => {
  it.each(endpoints)("exige une connexion pour $name", async ({ run }) => {
    mocks.auth.mockResolvedValue(null);
    const result = await run();
    expect(result.status).toBe(401);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.onboarding).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.removeRemote).not.toHaveBeenCalled();
  });

  it.each(endpoints)("exige la configuration initiale terminée pour $name", async ({ run }) => {
    mocks.onboarding.mockResolvedValue("pending");
    expect((await run()).status).toBe(403);
    expect(mocks.onboarding).toHaveBeenCalledWith(database, USER);
    expect(mocks.providers).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.removeRemote).not.toHaveBeenCalled();
  });

  it.each(["session", "complete", "disconnect"])("refuse une origine externe avant authentification sur %s", async (endpoint) => {
    const req = request(endpoint, { ...INPUT, connectionId: remoteConnection.connectionId }, { Origin: "https://attacker.example.test" });
    const result = endpoint === "session" ? await sessionPOST(req) : endpoint === "complete" ? await completePOST(req) : await disconnect(req);
    expect(result.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.removeRemote).not.toHaveBeenCalled();
  });

  it.each([{ Origin: "" }, { "Sec-Fetch-Site": "cross-site" }] as Record<string, string>[])("refuse les demandes POST sans origine fiable %#", async (headers) => {
    expect((await sessionPOST(request("connect/session", INPUT, headers))).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("renvoie le catalogue privé sans exiger un en-tête Origin sur GET", async () => {
    const result = await catalogGET();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ configured: false, source: "local", apps: [] });
    expect(mocks.catalog).toHaveBeenCalledTimes(1);
  });
});

describe("validation des demandes de connexion", () => {
  it.each(["session", "complete"])("refuse les données invalides avant Nango sur %s", async (endpoint) => {
    const req = request(`connect/${endpoint}`, { ...INPUT, providerId: "..", connectionId: remoteConnection.connectionId });
    const result = await (endpoint === "session" ? sessionPOST(req) : completePOST(req));
    expect(result.status).toBe(400);
    expect(mocks.providers).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.owned).not.toHaveBeenCalled();
  });

  it.each([
    { url: "javascript:alert(1)" }, { url: "https://user:password@example.test" }, { category: "invalid-category" },
    { space: "other-user-space" }, { pinned: "true" }, { name: "" }, { integrationId: "bad\nvalue" },
  ])("refuse les valeurs de formulaire invalides %#", async (override) => {
    expect((await sessionPOST(request("connect/session", { ...INPUT, ...override }))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/json-foo"])("refuse le format %s", async (contentType) => {
    expect((await sessionPOST(request("connect/session", INPUT, { "Content-Type": contentType }))).status).toBe(415);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("accepte application/json avec son encodage", async () => {
    expect((await sessionPOST(request("connect/session", INPUT, { "Content-Type": "application/json; charset=utf-8" }))).status).toBe(200);
  });

  it("refuse un JSON mal formé", async () => {
    const req = new Request(`${ORIGIN}/api/apps/connect/session`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: "{invalid" });
    expect((await sessionPOST(req)).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("limite la taille de la demande même sans content-length", async () => {
    expect((await sessionPOST(request("connect/session", { ...INPUT, ignored: "x".repeat(17_000) }))).status).toBe(413);
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.providers).not.toHaveBeenCalled();
  });

  it("exige l'identifiant de connexion lors de la confirmation", async () => {
    expect((await completePOST(request("connect/complete"))).status).toBe(400);
    expect(mocks.owned).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});

describe("création d'une session OAuth limitée", () => {
  it("utilise l'identité authentifiée et l'intégration configurée", async () => {
    const result = await sessionPOST(request("connect/session", { ...INPUT, userId: "attacker-selected-user", allowed_integrations: ["other-service"], credentials: SECRET }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ token: "limited-connect-session", expiresAt: "2026-10-17T10:30:00.000Z" });
    expect(mocks.session).toHaveBeenCalledExactlyOnceWith(USER, INPUT.integrationId);
    expect(mocks.reserve).toHaveBeenCalledExactlyOnceWith(database);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each(["API_KEY", "OAUTH2_CC", "BASIC", "NONE"])("interdit une session d'utilisateur pour %s", async (auth_mode) => {
    mocks.providers.mockResolvedValue([{ ...provider, auth_mode }]);
    expect((await sessionPOST(request("connect/session"))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it.each([{ integrations: [] }, { integrations: [{ unique_key: INPUT.integrationId, provider: "other-service" }] }])("refuse les intégrations absentes ou liées à un autre service %#", async ({ integrations }) => {
    mocks.integrations.mockResolvedValue(integrations);
    expect((await sessionPOST(request("connect/session"))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("vérifie la migration avant de commencer une autorisation externe", async () => {
    mocks.reserve.mockRejectedValue({ code: "42P01" });
    const result = await sessionPOST(request("connect/session"));
    expect(result.status).toBe(503);
    expect(mocks.providers).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("bloque les tentatives au-delà du quota sans appeler Nango", async () => {
    mocks.reserve.mockResolvedValue({ allowed: false, retryAfterSeconds: 83 });
    const result = await sessionPOST(request("connect/session"));
    expect(result.status).toBe(429);
    expect(await result.json()).toEqual({ error: expect.stringContaining("2 minute(s)") });
    expect(mocks.providers).not.toHaveBeenCalled();
    expect(mocks.integrations).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });
});

describe("confirmation d'une connexion autorisée", () => {
  it("vérifie le propriétaire avant l'écriture et ne renvoie aucune donnée secrète", async () => {
    mocks.owned.mockResolvedValue({ ...remoteConnection, credentials: { access_token: SECRET }, metadata: { secret: SECRET } });
    const result = await completePOST(completion({ userId: "attacker-user", providerName: "Untrusted name", credentials: SECRET }));
    expect(result.status).toBe(200);
    const body = await result.text();
    expect(JSON.parse(body)).toEqual({ ok: true, shortcutId: SHORTCUT });
    expect(body).not.toContain(SECRET);
    expect(mocks.owned).toHaveBeenCalledExactlyOnceWith(USER, INPUT.integrationId, remoteConnection.connectionId);
    expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(database, expect.objectContaining({ ...INPUT, connectionId: remoteConnection.connectionId, providerName: "GitHub", url: "https://github.com/login" }));
    expect(mocks.owned.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]);
    expect(mocks.complete.mock.calls[0][1]).not.toHaveProperty("credentials");
    expect(mocks.complete.mock.calls[0][1]).not.toHaveProperty("userId");
    expect(mocks.revalidate.mock.calls).toEqual([["/apps"], ["/"]]);
  });

  it("bloque un résultat OAuth appartenant à un autre service", async () => {
    mocks.owned.mockResolvedValue({ ...remoteConnection, providerId: "other-provider" });
    expect((await completePOST(completion())).status).toBe(403);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("n'enregistre rien si Nango refuse la propriété de la connexion", async () => {
    const error = Object.assign(new UserError("Connexion introuvable."), { status: 404 });
    mocks.owned.mockRejectedValue(error);
    expect((await completePOST(completion())).status).toBe(404);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("signale l'échec de persistance sans annoncer un succès ni revalider", async () => {
    mocks.complete.mockRejectedValue({ code: "42P01" });
    expect((await completePOST(completion())).status).toBe(503);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("déconnexion d'une app", () => {
  it("ne contacte pas Nango pour une référence invalide", async () => {
    expect((await disconnect(undefined, "invalid-id")).status).toBe(404);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.removeRemote).not.toHaveBeenCalled();
    expect(mocks.removeLocal).not.toHaveBeenCalled();
  });

  it("ne contacte pas Nango pour un enregistrement inaccessible à l'utilisateur", async () => {
    mocks.get.mockResolvedValue(null);
    expect((await disconnect()).status).toBe(404);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(database, ID);
    expect(mocks.removeRemote).not.toHaveBeenCalled();
    expect(mocks.removeLocal).not.toHaveBeenCalled();
  });

  it("préserve la connexion locale quand la suppression distante échoue", async () => {
    mocks.removeRemote.mockRejectedValue(Object.assign(new UserError("Service temporairement indisponible."), { status: 503 }));
    expect((await disconnect()).status).toBe(503);
    expect(mocks.removeLocal).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("supprime d'abord la connexion vérifiée puis son association et actualise le widget", async () => {
    const result = await disconnect();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(mocks.removeRemote).toHaveBeenCalledExactlyOnceWith(USER, INPUT.integrationId, remoteConnection.connectionId);
    expect(mocks.removeLocal).toHaveBeenCalledExactlyOnceWith(database, ID);
    expect(mocks.removeRemote.mock.invocationCallOrder[0]).toBeLessThan(mocks.removeLocal.mock.invocationCallOrder[0]);
    expect(mocks.revalidate.mock.calls).toEqual([["/apps"], ["/"]]);
  });

  it("ne revalide pas si l'association locale n'a pas pu être supprimée", async () => {
    mocks.removeLocal.mockRejectedValue(new Error("database unavailable"));
    expect((await disconnect()).status).toBe(500);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

describe("confidentialité des erreurs OAuth", () => {
  it.each(["session", "owned", "complete", "removeRemote"] as const)("ne journalise et ne renvoie pas les détails sensibles d'une erreur %s", async (stage) => {
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
    mocks[stage].mockRejectedValue(new Error(`${SECRET}: raw upstream response`));
    const result = stage === "session" ? await sessionPOST(request("connect/session")) : stage === "removeRemote" ? await disconnect() : await completePOST(completion());
    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain(SECRET);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });
});
