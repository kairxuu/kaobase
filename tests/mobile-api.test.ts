import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  onboarding: vi.fn(),
  setup: vi.fn(),
  task: vi.fn(),
  revalidate: vi.fn(),
  conversations: vi.fn(),
  conversation: vi.fn(),
  deletions: vi.fn(),
  remove: vi.fn(),
  accounts: vi.fn(),
  categories: vi.fn(),
  distribution: vi.fn(),
  subscription: vi.fn(),
}));
vi.mock("@/lib/mobile/auth", () => ({ mobileSession: mocks.auth }));
vi.mock("@/lib/data/onboarding", () => ({
  getOnboardingStatus: mocks.onboarding,
  completeSetup: mocks.setup,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/data/tasks", async (original) => ({
  ...(await original<typeof import("@/lib/data/tasks")>()),
  createTask: mocks.task,
}));
vi.mock("@/lib/data/subscriptions", async (original) => ({
  ...(await original<typeof import("@/lib/data/subscriptions")>()),
  updateSubscription: mocks.subscription,
}));
vi.mock("@/lib/data/agents", () => ({
  listConversations: mocks.conversations,
  getConversation: mocks.conversation,
  deleteConversation: mocks.remove,
}));
vi.mock("@/lib/agents/deletions", () => ({
  pendingDeletions: mocks.deletions,
}));
vi.mock("@/lib/data/finance", async (original) => ({
  ...(await original<typeof import("@/lib/data/finance")>()),
  getAccounts: mocks.accounts,
  getCategories: mocks.categories,
  transactionDistributionRows: mocks.distribution,
}));
import { GET, POST, PATCH, DELETE } from "@/app/api/mobile/[...path]/route";
const userId = "10000000-0000-4000-8000-000000000001";
const db = { from: vi.fn() };
const ctx = (path: string) => ({
  params: Promise.resolve({ path: path.split("/") }),
});
const request = (path: string, method = "GET", body?: unknown) =>
  new Request("https://kaobase.test/api/mobile/" + path, {
    method,
    headers: {
      Authorization: "Bearer verified-jwt",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ db, userId, email: "test@example.test" });
  mocks.onboarding.mockResolvedValue("complete");
});
describe("accès à l'API native", () => {
  it.each([
    { method: "GET", run: GET },
    { method: "POST", run: POST },
    { method: "PATCH", run: PATCH },
    { method: "DELETE", run: DELETE },
  ])(
    "refuse $method sans session et ne cache jamais les réponses privées",
    async ({ method, run }) => {
      mocks.auth.mockResolvedValue(null);
      const response = await run(request("tasks", method), ctx("tasks"));
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Vary")).toBe("Authorization");
      expect(mocks.task).not.toHaveBeenCalled();
    },
  );
  it("exige la configuration avant toute action métier", async () => {
    mocks.onboarding.mockResolvedValue("pending");
    const response = await POST(
      request("tasks", "POST", { title: "Hello" }),
      ctx("tasks"),
    );
    expect(response.status).toBe(409);
    expect(mocks.task).not.toHaveBeenCalled();
  });
  it("échoue sans action si l'état du profil est inaccessible", async () => {
    mocks.onboarding.mockResolvedValue("unavailable");
    expect((await GET(request("overview"), ctx("overview"))).status).toBe(503);
  });
  it("permet le parcours initial sans configuration préalable", async () => {
    mocks.onboarding.mockResolvedValue("pending");
    const payload = {
      displayName: "Alex",
      currency: "EUR",
      timezone: "Europe/Paris",
      accountId: null,
      accountName: "Courant",
      accountKind: "checking",
      openingBalance: 0,
      space: "perso",
    };
    expect(
      (await POST(request("setup", "POST", payload), ctx("setup"))).status,
    ).toBe(200);
    expect(mocks.setup).toHaveBeenCalledWith(db, payload);
  });
  it("refuse d'écrire pour une identité choisie par le client", async () => {
    const response = await POST(
      request("tasks", "POST", {
        title: "Test",
        priority: "medium",
        dueDate: null,
        space: "perso",
        user_id: "victim",
      }),
      ctx("tasks"),
    );
    expect(response.status).toBe(400);
    expect(mocks.task).not.toHaveBeenCalled();
  });
  it("utilise les fonctions métier avec le client lié au JWT", async () => {
    const payload = {
      title: "Test",
      priority: "high",
      dueDate: null,
      space: "pro",
    };
    expect(
      (await POST(request("tasks", "POST", payload), ctx("tasks"))).status,
    ).toBe(200);
    expect(mocks.task).toHaveBeenCalledWith(db, payload);
  });
  it("borne les corps même sans Content-Length", async () => {
    const response = await POST(
      request("tasks", "POST", { title: "x".repeat(40000) }),
      ctx("tasks"),
    );
    expect(response.status).toBe(400);
    expect(mocks.task).not.toHaveBeenCalled();
  });
  it("ne divulgue pas une erreur contenant un secret serveur", async () => {
    mocks.task.mockRejectedValue(new Error("private-database-password"));
    const response = await POST(
      request("tasks", "POST", {
        title: "Test",
        priority: "medium",
        dueDate: null,
        space: "perso",
      }),
      ctx("tasks"),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-database-password");
  });
});

describe("historique et répartitions iOS", () => {
  it("charge l’historique avec le client authentifié", async () => {
    mocks.conversations.mockResolvedValue([
      { id: userId, title: "Ma question", lastAt: "2026-10-18" },
    ]);
    const response = await GET(request("conversations"), ctx("conversations"));
    expect(response.status).toBe(200);
    expect(mocks.conversations).toHaveBeenCalledWith(db);
    expect((await response.json())[0].title).toBe("Ma question");
  });
  it("restaure les messages et les demandes de suppression sans les exécuter", async () => {
    mocks.conversation.mockResolvedValue([
      { role: "user", content: "Bonjour" },
    ]);
    mocks.deletions.mockResolvedValue([]);
    const route = "conversations/" + userId;
    const response = await GET(request(route), ctx(route));
    expect(await response.json()).toEqual({
      messages: [{ role: "user", content: "Bonjour" }],
      deletions: [],
    });
    expect(mocks.conversation).toHaveBeenCalledWith(db, userId);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("ne supprime qu’avec DELETE et un identifiant valide", async () => {
    const route = "conversations/" + userId;
    expect((await DELETE(request(route, "DELETE"), ctx(route))).status).toBe(
      200,
    );
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(db, userId);
    expect(
      (
        await DELETE(
          request("conversations/invalid", "DELETE"),
          ctx("conversations/invalid"),
        )
      ).status,
    ).toBe(400);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
  it("calcule la répartition complète avec les filtres et ignore les virements", async () => {
    mocks.accounts.mockResolvedValue([{ id: userId }]);
    mocks.categories.mockResolvedValue([
      { id: "food", name: "Courses", kind: "expense", color: "#123456" },
      { id: "transfer", name: "Virement", kind: "transfer", color: "#111111" },
    ]);
    mocks.distribution.mockResolvedValue([
      { category_id: "food", amount: -12.5 },
      { category_id: "transfer", amount: -100 },
      { category_id: "food", amount: 20 },
    ]);
    const response = await GET(
      request("transaction-distribution?space=pro&search=courses"),
      ctx("transaction-distribution"),
    );
    expect(mocks.distribution).toHaveBeenCalledWith(db, {
      accountIds: [userId],
      search: "courses",
    });
    expect(await response.json()).toEqual([
      { id: "food", name: "Courses", color: "#123456", amount: 12.5 },
    ]);
  });
  it("ne présente pas de total partiel quand le calcul échoue", async () => {
    mocks.accounts.mockResolvedValue([]);
    mocks.categories.mockResolvedValue([]);
    mocks.distribution.mockRejectedValue(new Error("private-secret"));
    const response = await GET(
      request("transaction-distribution"),
      ctx("transaction-distribution"),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-secret");
  });
});

it("modifie une catégorie d’abonnement sans écraser son statut", async () => {
  const route = "subscriptions/" + userId;
  expect(
    (await PATCH(request(route, "PATCH", { categoryId: userId }), ctx(route)))
      .status,
  ).toBe(200);
  expect(mocks.subscription).toHaveBeenCalledWith(db, userId, {
    category_id: userId,
  });
  expect((await PATCH(request(route, "PATCH", {}), ctx(route))).status).toBe(
    400,
  );
});
it("ne mélange pas les devises dans la répartition native", async () => {
  mocks.accounts.mockResolvedValue([
    { id: "eur", currency: "EUR" },
    { id: "usd", currency: "USD" },
  ]);
  mocks.categories.mockResolvedValue([]);
  mocks.distribution.mockResolvedValue([]);
  const response = await GET(
    request("transaction-distribution?currency=USD"),
    ctx("transaction-distribution"),
  );
  expect(response.status).toBe(200);
  expect(mocks.distribution).toHaveBeenCalledWith(db, {
    accountIds: ["usd"],
    search: "",
  });
  expect(
    (
      await GET(
        request("transaction-distribution?currency=FAKE"),
        ctx("transaction-distribution"),
      )
    ).status,
  ).toBe(400);
});
