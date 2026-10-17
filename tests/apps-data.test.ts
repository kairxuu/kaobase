import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Supabase } from "@/lib/supabase/server";
import { createAppShortcut, deleteAppShortcut, listAppShortcuts, pinAppShortcut, updateAppShortcut } from "@/lib/data/apps";

const app = { id: "10000000-0000-4000-8000-000000000001", name: "Gmail", url: "https://mail.google.com/", account_label: "moi@example.com", category: "communication", space: "pro", pinned: true };
const input = { name: app.name, url: app.url, accountLabel: app.account_label, category: "communication" as const, space: "pro" as const, pinned: true };

function database(response = { data: app as unknown, error: null as unknown }) {
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain),
    insert: vi.fn(() => chain), update: vi.fn(() => chain), delete: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(response), maybeSingle: vi.fn().mockResolvedValue(response),
    limit: vi.fn().mockResolvedValue(response), range: vi.fn().mockResolvedValue(response),
  };
  const from = vi.fn(() => chain);
  return { ...chain, from, client: { from } as unknown as Supabase };
}

describe("lecture des apps", () => {
  it("limite le widget aux apps épinglées de l'espace actif", async () => {
    const db = database({ data: [app], error: null });
    expect(await listAppShortcuts(db.client, "pro", { pinnedOnly: true, limit: 8 })).toEqual([app]);
    expect(db.eq.mock.calls).toEqual([["space", "pro"], ["pinned", true]]);
    expect(db.limit).toHaveBeenCalledWith(8);
  });
  it("charge les pages suivantes sans tronquer la liste au plafond REST", async () => {
    const db = database();
    const first = Array.from({ length: 200 }, (_, n) => ({ ...app, id: String(n) }));
    db.range.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [{ ...app, id: "last" }], error: null });
    expect(await listAppShortcuts(db.client, "all")).toHaveLength(201);
    expect(db.range.mock.calls).toEqual([[0, 199], [200, 399]]);
    expect(db.eq).not.toHaveBeenCalled();
  });
  it("signale l'indisponibilité au widget au lieu de la présenter comme une liste vide", async () => {
    const db = database({ data: null, error: { code: "PGRST205" } });
    await expect(listAppShortcuts(db.client, "all", { limit: 8 })).rejects.toMatchObject({ code: "PGRST205" });
  });
});

describe("mutation des raccourcis", () => {
  it("laisse le propriétaire dériver de la session RLS, jamais du formulaire", async () => {
    const db = database();
    await createAppShortcut(db.client, input);
    expect(db.insert).toHaveBeenCalledWith({ name: app.name, url: app.url, account_label: app.account_label, category: "communication", space: "pro", pinned: true });
  });
  it("traduit les doublons en erreur de compte déjà enregistré", async () => {
    const db = database({ data: null, error: { code: "23505" } });
    await expect(createAppShortcut(db.client, input)).rejects.toThrow("déjà enregistré");
  });
  it.each(["update", "pin", "delete"])("n'annonce pas un succès %s si aucune ligne n'a été affectée", async (action) => {
    const db = database({ data: null, error: null });
    const operation = action === "update" ? updateAppShortcut(db.client, app.id, input)
      : action === "pin" ? pinAppShortcut(db.client, app.id, false) : deleteAppShortcut(db.client, app.id);
    await expect(operation).rejects.toThrow("App introuvable");
  });
});
