import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), onboarding: vi.fn(), setup: vi.fn(), task: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/mobile/auth", () => ({ mobileSession: mocks.auth }));
vi.mock("@/lib/data/onboarding", () => ({ getOnboardingStatus: mocks.onboarding, completeSetup: mocks.setup }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/data/tasks", async (original) => ({ ...await original<typeof import("@/lib/data/tasks")>(), createTask: mocks.task }));
import { GET, POST, PATCH, DELETE } from "@/app/api/mobile/[...path]/route";
const userId = "10000000-0000-4000-8000-000000000001";
const db = { from: vi.fn() };
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
const request = (path: string, method = "GET", body?: unknown) => new Request("https://kaobase.test/api/mobile/" + path, { method, headers: { Authorization: "Bearer verified-jwt", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ db, userId, email: "test@example.test" });
  mocks.onboarding.mockResolvedValue("complete");
});
describe("accès à l'API native", () => {
  it.each([{ method: "GET", run: GET }, { method: "POST", run: POST }, { method: "PATCH", run: PATCH }, { method: "DELETE", run: DELETE }])("refuse $method sans session et ne cache jamais les réponses privées", async ({ method, run }) => {
    mocks.auth.mockResolvedValue(null);
    const response = await run(request("tasks", method), ctx("tasks"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Authorization");
    expect(mocks.task).not.toHaveBeenCalled();
  });
  it("exige la configuration avant toute action métier", async () => {
    mocks.onboarding.mockResolvedValue("pending");
    const response = await POST(request("tasks", "POST", { title: "Hello" }), ctx("tasks"));
    expect(response.status).toBe(409); expect(mocks.task).not.toHaveBeenCalled();
  });
  it("échoue sans action si l'état du profil est inaccessible", async () => {
    mocks.onboarding.mockResolvedValue("unavailable");
    expect((await GET(request("overview"), ctx("overview"))).status).toBe(503);
  });
  it("permet le parcours initial sans configuration préalable", async () => {
    mocks.onboarding.mockResolvedValue("pending");
    const payload = { displayName: "Alex", currency: "EUR", timezone: "Europe/Paris", accountId: null, accountName: "Courant", accountKind: "checking", openingBalance: 0, space: "perso" };
    expect((await POST(request("setup", "POST", payload), ctx("setup"))).status).toBe(200);
    expect(mocks.setup).toHaveBeenCalledWith(db, payload);
  });
  it("refuse d'écrire pour une identité choisie par le client", async () => {
    const response = await POST(request("tasks", "POST", { title: "Test", priority: "medium", dueDate: null, space: "perso", user_id: "victim" }), ctx("tasks"));
    expect(response.status).toBe(400); expect(mocks.task).not.toHaveBeenCalled();
  });
  it("utilise les fonctions métier avec le client lié au JWT", async () => {
    const payload = { title: "Test", priority: "high", dueDate: null, space: "pro" };
    expect((await POST(request("tasks", "POST", payload), ctx("tasks"))).status).toBe(200);
    expect(mocks.task).toHaveBeenCalledWith(db, payload);
  });
  it("borne les corps même sans Content-Length", async () => {
    const response = await POST(request("tasks", "POST", { title: "x".repeat(40000) }), ctx("tasks"));
    expect(response.status).toBe(400); expect(mocks.task).not.toHaveBeenCalled();
  });
  it("ne divulgue pas une erreur contenant un secret serveur", async () => {
    mocks.task.mockRejectedValue(new Error("private-database-password"));
    const response = await POST(request("tasks", "POST", { title: "Test", priority: "medium", dueDate: null, space: "perso" }), ctx("tasks"));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain("private-database-password");
  });
});
