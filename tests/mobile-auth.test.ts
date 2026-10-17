import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ client: vi.fn(), identity: vi.fn(), fetch: vi.fn(), user: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.client }));
vi.mock("@/lib/data/identity", () => ({ ensureAppIdentity: mocks.identity }));
import { mobileSession } from "@/lib/mobile/auth";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon");
  vi.stubEnv("DATABASE_PROVIDER", "neon");
  vi.stubEnv("NEON_DATA_API_URL", "https://data.example.test/rest/v1");
  mocks.client.mockImplementation(() => ({ auth: { getUser: mocks.user }, from: vi.fn(), rpc: vi.fn() }));
  mocks.user.mockResolvedValue({ data: { user: { id: "verified-id", email: "me@example.test" } }, error: null });
  mocks.fetch.mockResolvedValue(Response.json([]));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("session mobile", () => {
  it.each([undefined, "Basic token", "Bearer ", "Bearer a b", "Bearer " + "x".repeat(16385)])("refuse un en-tête absent ou invalide", async (header) => {
    const result = await mobileSession(new Request("https://app.test", { headers: header ? { Authorization: header } : {} }));
    expect(result).toBeNull(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("refuse un token rejeté par Auth avant toute lecture en base", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
    expect(await mobileSession(new Request("https://app.test", { headers: { Authorization: "Bearer forged-token" } }))).toBeNull();
    expect(mocks.user).toHaveBeenCalledWith("forged-token");
    expect(mocks.identity).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("vérifie l'identité et transmet uniquement le JWT utilisateur à Neon", async () => {
    const session = await mobileSession(new Request("https://app.test", { headers: { Authorization: "Bearer user-jwt" } }));
    expect(session?.userId).toBe("verified-id"); expect(mocks.identity).toHaveBeenCalledOnce();
    await session!.supabase.from("profiles").select("id");
    expect(mocks.fetch.mock.calls[0][0].toString()).toBe("https://data.example.test/rest/v1/profiles?select=id");
    const headers = new Headers(mocks.fetch.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer user-jwt"); expect(headers.has("apikey")).toBe(false);
    expect(mocks.client.mock.calls[0][2].auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
  });
});
