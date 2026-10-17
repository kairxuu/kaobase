import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { DatabaseClient } from "@/lib/database/server";
import { completeAppConnection, deleteAppConnection, getAppConnection, getShortcutConnection, listAppConnections, reserveAppConnectSession } from "@/lib/data/app-connections";

const connection = {
  id: "70000000-0000-4000-8000-000000000001", shortcut_id: "70000000-0000-4000-8000-000000000002",
  provider_id: "google-mail", provider_name: "Gmail", integration_id: "gmail-pro", connection_id: "external-id",
  connected_at: "2026-10-17T10:00:00Z",
};
const input = {
  name: "Gmail", url: "https://mail.google.com/", accountLabel: "Work", category: "communication" as const, space: "pro" as const, pinned: true,
  providerId: connection.provider_id, providerName: connection.provider_name, integrationId: connection.integration_id, connectionId: connection.connection_id,
};

function database(response = { data: connection as unknown, error: null as unknown }) {
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain), delete: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(response), range: vi.fn().mockResolvedValue(response),
  };
  const from = vi.fn(() => chain);
  const rpc = vi.fn().mockResolvedValue(response);
  return { ...chain, from, rpc, client: { from, rpc } as unknown as DatabaseClient };
}

describe("références OAuth dans la couche de données", () => {
  it("charge toutes les pages avec un ordre stable et des colonnes non secrètes", async () => {
    const db = database();
    db.range.mockResolvedValueOnce({ data: Array.from({ length: 200 }, () => connection), error: null })
      .mockResolvedValueOnce({ data: [connection], error: null });
    expect(await listAppConnections(db.client)).toHaveLength(201);
    expect(db.from).toHaveBeenCalledWith("app_oauth_connections");
    expect(db.range.mock.calls).toEqual([[0, 199], [200, 399]]);
    expect(db.order.mock.calls).toEqual([
      ["connected_at", { ascending: false }], ["id"], ["connected_at", { ascending: false }], ["id"],
    ]);
    expect(db.select).toHaveBeenCalledWith("id, shortcut_id, provider_id, provider_name, integration_id, connection_id, connected_at");
  });

  it("retourne une liste vide pour un utilisateur sans connexion", async () => {
    const db = database({ data: null, error: null });
    expect(await listAppConnections(db.client)).toEqual([]);
  });

  it("retrouve une connexion ou le lien d'un raccourci en laissant RLS vérifier le propriétaire", async () => {
    const db = database();
    expect(await getAppConnection(db.client, connection.id)).toEqual(connection);
    expect(await getShortcutConnection(db.client, connection.shortcut_id)).toEqual(connection);
    expect(db.eq.mock.calls).toEqual([["id", connection.id], ["shortcut_id", connection.shortcut_id]]);
    const absent = database({ data: null, error: null });
    expect(await getAppConnection(absent.client, connection.id)).toBeNull();
    expect(await getShortcutConnection(absent.client, connection.shortcut_id)).toBeNull();
  });

  it.each(["list", "get", "shortcut"])("propage l'indisponibilité de la base en lecture %s", async (operation) => {
    const error = { code: "PGRST205" };
    const db = database({ data: null, error });
    const request = operation === "list" ? listAppConnections(db.client) : operation === "get"
      ? getAppConnection(db.client, connection.id) : getShortcutConnection(db.client, connection.shortcut_id);
    await expect(request).rejects.toEqual(error);
  });

  it("crée atomiquement le raccourci et son association sans propriétaire injecté", async () => {
    const db = database({ data: connection.shortcut_id, error: null });
    expect(await completeAppConnection(db.client, { ...input, user_id: "injected" } as typeof input)).toBe(connection.shortcut_id);
    expect(db.rpc).toHaveBeenCalledWith("complete_app_oauth_connection", {
      p_provider_id: "google-mail", p_provider_name: "Gmail", p_integration_id: "gmail-pro", p_connection_id: "external-id",
      p_name: "Gmail", p_url: "https://mail.google.com/", p_account_label: "Work", p_category: "communication", p_space: "pro", p_pinned: true,
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("explique le conflit lorsqu'un raccourci possède déjà une autre connexion", async () => {
    const db = database({ data: null, error: { code: "23505" } });
    await expect(completeAppConnection(db.client, input)).rejects.toThrow("déjà associé");
  });

  it("propage les autres erreurs et rejette une réponse RPC sans identifiant", async () => {
    const db = database({ data: null, error: { code: "42501" } });
    await expect(completeAppConnection(db.client, input)).rejects.toMatchObject({ code: "42501" });
    await expect(completeAppConnection(database({ data: null, error: null }).client, input)).rejects.toThrow("n'a pas pu être enregistrée");
  });

  it("supprime uniquement l'association ciblée", async () => {
    const db = database({ data: { id: connection.id }, error: null });
    await deleteAppConnection(db.client, connection.id);
    expect(db.delete).toHaveBeenCalled();
    expect(db.eq).toHaveBeenCalledWith("id", connection.id);
    expect(db.select).toHaveBeenCalledWith("id");
  });

  it("refuse de signaler une suppression réussie si la ligne est absente ou inaccessible", async () => {
    await expect(deleteAppConnection(database({ data: null, error: null }).client, connection.id)).rejects.toThrow("Connexion introuvable");
    await expect(deleteAppConnection(database({ data: null, error: { code: "42501" } }).client, connection.id)).rejects.toMatchObject({ code: "42501" });
  });

  it.each([
    [{ allowed: true, retry_after_seconds: 0 }, { allowed: true, retryAfterSeconds: 0 }],
    [{ allowed: false, retry_after_seconds: 600 }, { allowed: false, retryAfterSeconds: 600 }],
  ])("retourne le résultat du quota serveur", async (row, expected) => {
    const db = database({ data: [row], error: null });
    expect(await reserveAppConnectSession(db.client)).toEqual(expected);
    expect(db.rpc).toHaveBeenCalledWith("reserve_app_connect_session");
  });

  it.each([null, [], [{ allowed: "true", retry_after_seconds: 0 }], [{ allowed: false, retry_after_seconds: 0 }], [{ allowed: false, retry_after_seconds: -1 }]])(
    "refuse une réponse de quota invalide", async (data) => {
      await expect(reserveAppConnectSession(database({ data, error: null }).client)).rejects.toThrow("limite de connexions");
    },
  );

  it("propage une erreur empêchant la réservation du quota", async () => {
    await expect(reserveAppConnectSession(database({ data: null, error: { code: "42501" } }).client)).rejects.toMatchObject({ code: "42501" });
  });
});
