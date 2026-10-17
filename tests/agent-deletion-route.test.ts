import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getUserForApi: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getUserForApi } from "@/lib/auth";
import { POST } from "@/app/api/agents/deletions/route";

const body = {
  requestId: "10000000-0000-4000-8000-000000000001",
  conversationId: "10000000-0000-4000-8000-000000000002",
  decision: "confirm",
};
function request(input: unknown = body, origin = "https://kaobase.example") {
  return new Request("https://kaobase.example/api/agents/deletions", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(input),
  });
}

describe("API de confirmation réservée au clic utilisateur", () => {
  const rpc = vi.fn();
  const getSession = vi.mocked(getUserForApi);
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ userId: "user", db: { rpc } } as unknown as NonNullable<Awaited<ReturnType<typeof getUserForApi>>>);
  });
  it("refuse sans session", async () => {
    getSession.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuse une origine tierce", async () => {
    expect((await POST(request(body, "https://other.example"))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuse une simple phrase affirmative sans identifiant de demande", async () => {
    expect((await POST(request({ message: "OK, montre mes dépenses", decision: "confirm" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("n'accepte aucune cible de suppression fournie par le client", async () => {
    rpc.mockResolvedValue({ data: [{ description: "Élément présenté" }], error: null });
    const res = await POST(request({ ...body, targetId: "victime", kind: "transaction" }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("confirm_agent_deletion", {
      p_request_id: body.requestId, p_conversation_id: body.conversationId,
    });
    expect(await res.json()).toEqual({ message: "Suppression confirmée : Élément présenté" });
  });
  it("n'annonce aucun succès si la confirmation est périmée", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "Confirmation expirée" } });
    const res = await POST(request());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Confirmation expirée" });
    vi.mocked(console.error).mockRestore();
  });
});
