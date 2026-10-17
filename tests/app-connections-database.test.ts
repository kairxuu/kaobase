import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigration, createDatabase } from "./helpers/database";

const USER_A = "71000000-0000-4000-8000-000000000001";
const USER_B = "71000000-0000-4000-8000-000000000002";
const COMPLETE_SQL = `select public.complete_app_oauth_connection($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as shortcut_id`;
const completeInput = ["google-mail", "Gmail", "gmail-pro", "external-a", "Gmail", "https://mail.google.com/", "Work", "communication", "pro", true];

async function authenticate(db: PGlite, userId = USER_A) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await db.exec("set local role authenticated");
}

async function expectRejected(db: PGlite, action: () => Promise<unknown>, code: string) {
  await db.exec("savepoint expected_rejection");
  try { await expect(action()).rejects.toMatchObject({ code }); }
  finally { await db.exec("rollback to savepoint expected_rejection; release savepoint expected_rejection"); }
}

describe("associations OAuth privées et atomiques dans PostgreSQL", () => {
  let db: PGlite;
  let ownId: string;
  let foreignId: string;
  let ownShortcut: string;
  let foreignShortcut: string;

  beforeAll(async () => {
    db = await createDatabase();
    await db.query("insert into auth.users (id, email) values ($1, 'oauth-a@example.test'), ($2, 'oauth-b@example.test')", [USER_A, USER_B]);
    await applyMigration(db, "20261017060000_app_shortcuts.sql");
    await applyMigration(db, "20261017070000_app_oauth_connections.sql");
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("begin");
    await authenticate(db, USER_B);
    foreignShortcut = (await db.query<{ shortcut_id: string }>(COMPLETE_SQL, completeInput)).rows[0].shortcut_id;
    foreignId = (await db.query<{ id: string }>("select id from public.app_oauth_connections")).rows[0].id;
    await authenticate(db);
    ownShortcut = (await db.query<{ shortcut_id: string }>(COMPLETE_SQL, completeInput)).rows[0].shortcut_id;
    ownId = (await db.query<{ id: string }>("select id from public.app_oauth_connections")).rows[0].id;
  });
  afterEach(async () => { await db.exec("rollback; reset role"); });

  it("crée le raccourci et les références, avec le propriétaire de session et sans champ de secret", async () => {
    expect((await db.query("select user_id, shortcut_id, provider_id, provider_name, integration_id, connection_id from public.app_oauth_connections")).rows)
      .toEqual([{ user_id: USER_A, shortcut_id: ownShortcut, provider_id: "google-mail", provider_name: "Gmail", integration_id: "gmail-pro", connection_id: "external-a" }]);
    expect((await db.query("select name, url, account_label, category, space, pinned from public.app_shortcuts")).rows)
      .toEqual([{ name: "Gmail", url: "https://mail.google.com/", account_label: "Work", category: "communication", space: "pro", pinned: true }]);
    const columns = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'app_oauth_connections' order by ordinal_position`)).rows.map((r) => r.column_name);
    expect(columns).toEqual(["id", "user_id", "shortcut_id", "provider_id", "provider_name", "integration_id", "connection_id", "connected_at"]);
  });

  it("rend un callback répété idempotent sans créer ni modifier le raccourci", async () => {
    const retry = [...completeInput];
    retry[4] = "Changed name"; retry[5] = "https://other.test/"; retry[6] = "Different label";
    expect((await db.query<{ shortcut_id: string }>(COMPLETE_SQL, retry)).rows).toEqual([{ shortcut_id: ownShortcut }]);
    expect((await db.query("select id, name from public.app_shortcuts")).rows).toEqual([{ id: ownShortcut, name: "Gmail" }]);
    expect((await db.query("select id from public.app_oauth_connections")).rows).toEqual([{ id: ownId }]);
  });

  it("refuse un callback dont le service diffère de l'association existante", async () => {
    const retry = [...completeInput]; retry[0] = "slack";
    await expectRejected(db, () => db.query(COMPLETE_SQL, retry), "23514");
  });

  it("réutilise un raccourci manuel sans en changer la personnalisation", async () => {
    const manual = (await db.query<{ id: string }>(`insert into public.app_shortcuts (name, url, account_label, space, pinned)
      values ('My personal name', 'https://example.test/', 'Alias', 'perso', false) returning id`)).rows[0].id;
    const input = ["notion", "Notion", "notion", "external-notion", "Notion", "https://example.test/", "Alias", "work", "perso", true];
    expect((await db.query<{ shortcut_id: string }>(COMPLETE_SQL, input)).rows[0].shortcut_id).toBe(manual);
    expect((await db.query("select name, pinned from public.app_shortcuts where id = $1", [manual])).rows)
      .toEqual([{ name: "My personal name", pinned: false }]);
    expect((await db.query("select id from public.app_shortcuts")).rows).toHaveLength(2);
  });

  it("refuse d'écraser une autre connexion et conserve les données existantes", async () => {
    const input = [...completeInput]; input[3] = "different-connection";
    await expectRejected(db, () => db.query(COMPLETE_SQL, input), "23505");
    expect((await db.query("select id, connection_id from public.app_oauth_connections")).rows).toEqual([{ id: ownId, connection_id: "external-a" }]);
    expect((await db.query("select id from public.app_shortcuts")).rows).toEqual([{ id: ownShortcut }]);
  });

  it("annule la création du raccourci lorsque l'insertion de l'association échoue", async () => {
    const input = [...completeInput]; input[0] = ""; input[3] = "new-connection"; input[5] = "https://new.test/";
    await expectRejected(db, () => db.query(COMPLETE_SQL, input), "23514");
    expect((await db.query("select id from public.app_shortcuts")).rows).toEqual([{ id: ownShortcut }]);
    expect((await db.query("select id from public.app_oauth_connections")).rows).toEqual([{ id: ownId }]);
  });

  it("cache les connexions étrangères et empêche leur modification et leur suppression", async () => {
    expect((await db.query("select id from public.app_oauth_connections")).rows).toEqual([{ id: ownId }]);
    expect((await db.query("select id from public.app_oauth_connections where id = $1", [foreignId])).rows).toEqual([]);
    expect((await db.query("update public.app_oauth_connections set provider_name = 'Stolen' where id = $1 returning id", [foreignId])).rows).toEqual([]);
    expect((await db.query("delete from public.app_oauth_connections where id = $1 returning id", [foreignId])).rows).toEqual([]);
  });

  it("interdit l'injection d'un propriétaire et le transfert d'une association", async () => {
    await expectRejected(db, () => db.query(`insert into public.app_oauth_connections
      (user_id, shortcut_id, provider_id, provider_name, integration_id, connection_id)
      values ($1, $2, 'slack', 'Slack', 'slack', 'external-slack')`, [USER_B, foreignShortcut]), "42501");
    await expectRejected(db, () => db.query("update public.app_oauth_connections set user_id = $1 where id = $2", [USER_B, ownId]), "42501");
  });

  it("refuse de lier un raccourci d'un autre propriétaire même pour une écriture privilégiée", async () => {
    await authenticate(db, USER_B);
    const unlinkedForeign = (await db.query<{ id: string }>(`insert into public.app_shortcuts
      (name, url) values ('Unlinked B', 'https://unlinked.test/') returning id`)).rows[0].id;
    await db.exec("reset role");
    await expectRejected(db, () => db.query("update public.app_oauth_connections set shortcut_id = $1 where id = $2", [unlinkedForeign, ownId]), "23503");
  });

  it("n'accorde aucun accès anonyme ni droit de troncature", async () => {
    await db.exec("set local role anon");
    for (const statement of [
      "select id from public.app_oauth_connections", "update public.app_oauth_connections set provider_name = 'Anon'",
      "delete from public.app_oauth_connections",
    ]) await expectRejected(db, () => db.exec(statement), "42501");
    await expectRejected(db, () => db.query(COMPLETE_SQL, completeInput), "42501");
    await authenticate(db);
    await expectRejected(db, () => db.exec("truncate table public.app_oauth_connections"), "42501");
  });

  it("exige une session authentifiée même avec le rôle authenticated", async () => {
    await authenticate(db, "");
    expect((await db.query("select id from public.app_oauth_connections")).rows).toEqual([]);
    await expectRejected(db, () => db.query(COMPLETE_SQL, completeInput), "42501");
  });

  it.each([
    ["provider_id", ""], ["provider_id", "x".repeat(129)], ["provider_id", " google-mail"], ["provider_id", "google\nmail"],
    ["provider_name", ""], ["provider_name", "x".repeat(161)], ["provider_name", "Gmail "], ["provider_name", "G\tmail"],
    ["integration_id", ""], ["integration_id", "x".repeat(256)], ["integration_id", " gmail"], ["integration_id", "g\rmail"],
    ["connection_id", ""], ["connection_id", "x".repeat(256)], ["connection_id", " external"], ["connection_id", "external\u007f"],
  ])("refuse la valeur invalide %s %j", async (field, value) => {
    await expectRejected(db, () => db.query(`update public.app_oauth_connections set ${field} = $1 where id = $2`, [value, ownId]), "23514");
  });

  it.each(["user_id", "shortcut_id", "provider_id", "provider_name", "integration_id", "connection_id", "connected_at"])(
    "exige le champ %s", async (field) => {
      await db.exec("reset role");
      await expectRejected(db, () => db.query(`update public.app_oauth_connections set ${field} = null where id = $1`, [ownId]), "23502");
    },
  );

  it("autorise les longueurs maximales des métadonnées", async () => {
    await db.query(`update public.app_oauth_connections set provider_id = $1, provider_name = $2,
      integration_id = $3, connection_id = $4 where id = $5`, ["p".repeat(128), "É".repeat(160), "i".repeat(255), "c".repeat(255), ownId]);
  });

  it("n'autorise qu'une connexion par raccourci et un lien par identité distante et utilisateur", async () => {
    const otherShortcut = (await db.query<{ id: string }>(`insert into public.app_shortcuts (name, url) values ('Other', 'https://other.test/') returning id`)).rows[0].id;
    await expectRejected(db, () => db.query(`insert into public.app_oauth_connections
      (shortcut_id, provider_id, provider_name, integration_id, connection_id) values ($1, 'slack', 'Slack', 'slack', 'external-slack')`, [ownShortcut]), "23505");
    await expectRejected(db, () => db.query(`insert into public.app_oauth_connections
      (shortcut_id, provider_id, provider_name, integration_id, connection_id) values ($1, 'google-mail', 'Gmail', 'gmail-pro', 'external-a')`, [otherShortcut]), "23505");
  });

  it("permet de retirer les métadonnées en conservant le raccourci", async () => {
    await db.query("delete from public.app_oauth_connections where id = $1", [ownId]);
    expect((await db.query("select id from public.app_oauth_connections")).rows).toEqual([]);
    expect((await db.query("select id from public.app_shortcuts")).rows).toEqual([{ id: ownShortcut }]);
  });

  it("supprime l'association lorsque son raccourci est supprimé", async () => {
    await db.query("delete from public.app_shortcuts where id = $1", [ownShortcut]);
    expect((await db.query("select id from public.app_oauth_connections")).rows).toEqual([]);
    await authenticate(db, USER_B);
    expect((await db.query("select id from public.app_oauth_connections")).rows).toEqual([{ id: foreignId }]);
  });

  it("supprime les associations lors de la suppression de l'utilisateur", async () => {
    await db.exec("reset role");
    await db.query("delete from auth.users where id = $1", [USER_A]);
    expect((await db.query("select id from public.app_oauth_connections")).rows).toEqual([{ id: foreignId }]);
    expect((await db.query("select id from public.app_shortcuts")).rows).toEqual([{ id: foreignShortcut }]);
  });

  it("autorise dix sessions en dix minutes puis bloque sans créer de réservation supplémentaire", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await db.query("select * from public.reserve_app_connect_session()")).rows).toEqual([{ allowed: true, retry_after_seconds: 0 }]);
    }
    for (let i = 0; i < 2; i++) {
      const denied = (await db.query<{ allowed: boolean; retry_after_seconds: number }>("select * from public.reserve_app_connect_session()")).rows[0];
      expect(denied.allowed).toBe(false);
      expect(denied.retry_after_seconds).toBeGreaterThan(0);
      expect(denied.retry_after_seconds).toBeLessThanOrEqual(600);
    }
    await db.exec("reset role");
    expect((await db.query("select count(*)::integer as count from public.app_connect_requests where user_id = $1", [USER_A])).rows).toEqual([{ count: 10 }]);
    await authenticate(db, USER_B);
    expect((await db.query("select * from public.reserve_app_connect_session()")).rows).toEqual([{ allowed: true, retry_after_seconds: 0 }]);
  });

  it("retire les réservations expirées et conserve celles de la fenêtre en cours", async () => {
    await db.exec("reset role");
    await db.query(`insert into public.app_connect_requests (user_id, created_at)
      select $1, clock_timestamp() - interval '11 minutes' from generate_series(1, 12)`, [USER_A]);
    await authenticate(db);
    expect((await db.query("select * from public.reserve_app_connect_session()")).rows).toEqual([{ allowed: true, retry_after_seconds: 0 }]);
    await db.exec("reset role");
    expect((await db.query("select count(*)::integer as count from public.app_connect_requests where user_id = $1", [USER_A])).rows).toEqual([{ count: 1 }]);
  });

  it("empêche les écritures et lectures directes des réservations OAuth", async () => {
    await db.query("select * from public.reserve_app_connect_session()");
    for (const statement of [
      "select id from public.app_connect_requests", "delete from public.app_connect_requests", "truncate public.app_connect_requests",
      "update public.app_connect_requests set created_at = '2000-01-01'",
      "insert into public.app_connect_requests (user_id) values ('71000000-0000-4000-8000-000000000001')",
    ]) await expectRejected(db, () => db.exec(statement), "42501");
  });

  it("refuse la réservation aux anonymes, aux sessions absentes et aux utilisateurs inexistants", async () => {
    await db.exec("set local role anon");
    await expectRejected(db, () => db.query("select * from public.reserve_app_connect_session()"), "42501");
    await authenticate(db, "");
    await expectRejected(db, () => db.query("select * from public.reserve_app_connect_session()"), "42501");
    await authenticate(db, "71000000-0000-4000-8000-000000000003");
    await expectRejected(db, () => db.query("select * from public.reserve_app_connect_session()"), "42501");
  });
});
