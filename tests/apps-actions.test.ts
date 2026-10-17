import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), revalidate: vi.fn(), space: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), pin: vi.fn(), connection: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/space", () => ({ getSpaceFilter: mocks.space, defaultSpace: (space: string) => space === "pro" ? "pro" : "perso" }));
vi.mock("@/lib/data/apps", () => ({ createAppShortcut: mocks.create, updateAppShortcut: mocks.update, deleteAppShortcut: mocks.remove, pinAppShortcut: mocks.pin }));
vi.mock("@/lib/data/app-connections", () => ({ getShortcutConnection: mocks.connection }));
import { createAppAction, deleteAppAction, pinAppAction, updateAppAction } from "@/app/(app)/apps/actions";

const ID = "10000000-0000-4000-8000-000000000001";
const client = {};
function form() {
  const data = new FormData();
  Object.entries({ name: "Gmail", url: "https://mail.google.com", accountLabel: "moi@example.com", category: "communication", pinned: "on" }).forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ supabase: client, userId: "owner" });
  mocks.space.mockResolvedValue("pro");
  mocks.create.mockResolvedValue({ id: ID });
  mocks.update.mockResolvedValue({ id: ID });
  mocks.remove.mockResolvedValue(undefined);
  mocks.pin.mockResolvedValue(undefined);
  mocks.connection.mockResolvedValue(null);
});

describe("actions Mes apps", () => {
  it("exige la déconnexion avant de supprimer un raccourci autorisé", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.connection.mockResolvedValue({ id: "connection" });
    expect(await deleteAppAction(ID)).toEqual({ ok: false, error: "Déconnecte cette app avant de supprimer son raccourci." });
    expect(mocks.remove).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("exige une session configurée avant toute mutation", async () => {
    mocks.requireUser.mockRejectedValue(new Error("redirect:/setup"));
    await expect(createAppAction(form())).rejects.toThrow("redirect:/setup");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("crée dans l'espace actif et actualise la page et le widget", async () => {
    expect(await createAppAction(form())).toMatchObject({ ok: true });
    expect(mocks.create).toHaveBeenCalledWith(client, expect.objectContaining({ space: "pro", accountLabel: "moi@example.com", pinned: true }));
    expect(mocks.revalidate.mock.calls).toEqual([["/apps"], ["/"]]);
  });
  it.each(["update", "pin", "delete"])("actualise aussi l'accueil après %s", async (action) => {
    const result = action === "update" ? await updateAppAction(ID, form()) : action === "pin" ? await pinAppAction(ID, false) : await deleteAppAction(ID);
    expect(result).toMatchObject({ ok: true });
    expect(mocks.revalidate.mock.calls).toEqual([["/apps"], ["/"]]);
  });
  it("refuse un identifiant invalide sans atteindre la base", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteAppAction("invalid")).toEqual({ ok: false, error: "App introuvable." });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("refuse une valeur d'épinglage forgée", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await pinAppAction(ID, "false" as unknown as boolean)).toMatchObject({ ok: false });
    expect(mocks.pin).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
