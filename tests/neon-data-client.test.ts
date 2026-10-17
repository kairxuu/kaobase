import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createNeonDataClient } from "@/lib/neon";
import { ensureAppIdentity } from "@/lib/data/identity";
import type { DatabaseClient } from "@/lib/database/server";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("DATABASE_PROVIDER", "neon");
  vi.stubEnv("NEON_DATA_API_URL", "https://example.apirest.neon.tech/neondb/rest/v1");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(Response.json([{ id: "own" }]));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("routage des données Neon avec les sessions Neon", () => {
  it("exige l'adresse Data API, sans utiliser l'URL administrateur", () => {
    vi.stubEnv("NEON_DATA_API_URL", "");
    expect(() => createNeonDataClient(async () => "jwt")).toThrow("NEON_DATA_API_URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["http://example.test/rest/v1", "https://user:password@example.test/rest/v1", "https://example.test/rest/v1?secret=key", "https://example.test/rest/v1#secret"])("refuse une adresse mal configurée : %s", (url) => {
    vi.stubEnv("NEON_DATA_API_URL", url);
    expect(() => createNeonDataClient(async () => "jwt")).toThrow();
  });
  it("interroge Neon avec le JWT utilisateur et conserve la requête PostgREST", async () => {
    const token = vi.fn().mockResolvedValue("signed-user-jwt");
    const result = await createNeonDataClient(token).from("profiles").select("currency").eq("id", "own");
    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, options] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.hostname).toBe("example.apirest.neon.tech");
    expect(url.pathname).toBe("/neondb/rest/v1/profiles");
    expect(url.searchParams.get("id")).toBe("eq.own");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer signed-user-jwt");
    expect(new Headers(options.headers).has("apikey")).toBe(false);
    expect(options).toMatchObject({ cache: "no-store", redirect: "error" });
  });
  it("renouvelle le jeton à chaque requête et route aussi les RPC vers Neon", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(true)));
    const token = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("refreshed");
    const client = createNeonDataClient(token);
    await client.rpc("ensure_app_user");
    await client.rpc("complete_onboarding", { p_display_name: "Camille" });
    expect(fetchMock.mock.calls.map(([, options]) => new Headers(options.headers).get("Authorization"))).toEqual(["Bearer first", "Bearer refreshed"]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/rpc/complete_onboarding");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ p_display_name: "Camille" });
  });
  it("refuse les lectures sans session sans envoyer de requête externe", async () => {
    const result = await createNeonDataClient(async () => null).from("profiles").select("*");
    expect(result.status).toBe(401);
    expect(result.error?.code).toBe("PGRST301");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("ne masque pas un refus RLS de Neon", async () => {
    fetchMock.mockResolvedValue(Response.json({ code: "42501", message: "permission denied" }, { status: 403 }));
    const result = await createNeonDataClient(async () => "jwt").from("transactions").insert({ user_id: "other" });
    expect(result.status).toBe(403);
    expect(result.error?.code).toBe("42501");
  });
});

describe("initialisation des identités", () => {
  it("utilise la session vérifiée, sans identifiant fourni au RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    rpc.mockImplementation((name:string)=>name==='current_identity'?{single:async()=>({data:{app_user_id:'legacy-id'},error:null})}:Promise.resolve({data:true,error:null}));
    await ensureAppIdentity({ rpc } as unknown as DatabaseClient);
    expect(rpc.mock.calls).toEqual([["ensure_app_user"],["current_identity"]]);
  });
  it("bloque l'accès si l'initialisation de l'identité échoue", async () => {
    const error = { code: "42501", message: "denied" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    await expect(ensureAppIdentity({ rpc } as unknown as DatabaseClient)).rejects.toEqual(error);
  });
});
