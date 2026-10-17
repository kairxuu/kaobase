import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), cookies: vi.fn(), fetch: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
import { createClient } from "@/lib/supabase/server";

function authClient() {
  return {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "verified-session-token" } }, error: null }), getClaims: vi.fn(), signInWithPassword: vi.fn() },
    from: vi.fn(), rpc: vi.fn(),
  };
}
beforeEach(() => {
  vi.stubEnv("DATABASE_PROVIDER", "neon");
  vi.stubEnv("NEON_DATA_API_URL", "https://endpoint.apirest.neon.tech/neondb/rest/v1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-auth-key");
  mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
  mocks.fetch.mockReset().mockImplementation(() => Promise.resolve(Response.json([])));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("client de session : auth Supabase et données Neon", () => {
  it("route les tables et RPC vers Neon et garde le même client d'authentification", async () => {
    const original = authClient();
    const oldFrom = original.from;
    const oldRpc = original.rpc;
    mocks.createServerClient.mockReturnValue(original);
    const client = await createClient();
    expect(client.auth).toBe(original.auth);
    await client.from("accounts").select("id");
    await client.rpc("ensure_app_user");
    await client.schema("public").from("profiles").select("id");
    expect(oldFrom).not.toHaveBeenCalled();
    expect(oldRpc).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/neondb/rest/v1/accounts", "/neondb/rest/v1/rpc/ensure_app_user", "/neondb/rest/v1/profiles"]);
    for (const [, init] of mocks.fetch.mock.calls) expect(new Headers(init.headers).get("Authorization")).toBe("Bearer verified-session-token");
    expect(mocks.createServerClient).toHaveBeenCalledWith("https://project.supabase.co", "public-auth-key", expect.any(Object));
  });
  it("permet un retour explicite à Supabase sans mélanger les données", async () => {
    vi.stubEnv("DATABASE_PROVIDER", "supabase");
    const original = authClient();
    mocks.createServerClient.mockReturnValue(original);
    const client = await createClient();
    client.from("profiles");
    expect(original.from).toHaveBeenCalledWith("profiles");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("ne retombe pas sur Supabase quand la configuration Neon manque", async () => {
    vi.stubEnv("NEON_DATA_API_URL", "");
    mocks.createServerClient.mockReturnValue(authClient());
    await expect(createClient()).rejects.toThrow("NEON_DATA_API_URL");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("refuse un accès si le renouvellement de session échoue", async () => {
    const original = authClient();
    original.auth.getSession.mockResolvedValue({ data: { session: null }, error: { message: "expired" } } as never);
    mocks.createServerClient.mockReturnValue(original);
    const result = await (await createClient()).from("profiles").select("id");
    expect(result.error).not.toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
