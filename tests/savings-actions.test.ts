import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({
    db: {
      from: () => ({
        insert: mocks.insert,
        update: (value: unknown) => {
          mocks.update(value);
          const q = {
            eq: () => q,
            select: () => q,
            single: async () => ({ data: { id: "account" }, error: null }),
          };
          return q;
        },
      }),
    },
  }),
}));
import { createAccountAction, updateAccountAction } from "@/app/(app)/actions";
function form(kind = "savings", balance = "1500,50") {
  const f = new FormData();
  f.set("name", "LEP");
  f.set("kind", kind);
  f.set("openingBalance", balance);
  f.set("space", "perso");
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockResolvedValue({ error: null });
});
describe("comptes épargne", () => {
  it("enregistre un LEP comme épargne et actualise son aperçu", async () => {
    expect(await createAccountAction(form())).toMatchObject({ ok: true });
    expect(mocks.insert).toHaveBeenCalledWith({
      name: "LEP",
      kind: "savings",
      opening_balance: 1500.5,
      space: "perso",
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/savings");
  });
  it("permet de reclasser un ancien compte comme livret", async () => {
    expect(await updateAccountAction("account", form())).toMatchObject({
      ok: true,
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "savings", opening_balance: 1500.5 }),
    );
  });
  it.each(["unknown", "../savings"])(
    "refuse le type %s avant écriture",
    async (kind) => {
      expect(await createAccountAction(form(kind))).toMatchObject({
        ok: false,
      });
      expect(mocks.insert).not.toHaveBeenCalled();
    },
  );
  it.each([
    createAccountAction,
    (f: FormData) => updateAccountAction("account", f),
  ])("ne remplace pas un solde invalide par zéro", async (action) => {
    expect(await action(form("savings", "abc"))).toMatchObject({ ok: false });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
