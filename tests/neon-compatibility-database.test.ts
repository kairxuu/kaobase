import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigration, createDatabase } from "./helpers/database";

const A = "81000000-0000-4000-8000-000000000001";
const B = "81000000-0000-4000-8000-000000000002";
const NEW = "81000000-0000-4000-8000-000000000003";
let db: PGlite;
let migration: string;
async function authenticate(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [id, JSON.stringify({ sub: id, email: "member@example.test", user_metadata: { display_name: "Camille" } })]);
  await db.exec("set local role authenticated");
}
async function rejected(action: () => Promise<unknown>, code = "42501") {
  await db.exec("savepoint denied");
  try { await expect(action()).rejects.toMatchObject({ code }); }
  finally { await db.exec("rollback to savepoint denied; release savepoint denied"); }
}

describe("migration DatabaseClient vers Neon : droits et identités", () => {
  beforeAll(async () => {
    db = await createDatabase();
    await db.exec("alter table auth.users add column created_at timestamptz default now(), add column updated_at timestamptz default now()");
    await db.query("insert into auth.users(id,email) values ($1,'a@example.test'),($2,'b@example.test')", [A, B]);
    for (const name of ["20261017020000_subscription_identity.sql", "20261017030000_agent_deletion_requests.sql", "20261017040000_agent_request_limits.sql", "20261017050000_onboarding.sql", "20261017060000_app_shortcuts.sql", "20261017070000_app_oauth_connections.sql"]) await applyMigration(db, name);
    migration = await readFile(new URL("../database/neon/20261017080000_supabase_compatibility.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("begin"); await authenticate(A); });
  afterEach(async () => { await db.exec("rollback; reset role"); });

  it("conserve les comptes privés et les vues soumises à la RLS", async () => {
    expect((await db.query("select user_id from public.accounts")).rows).toEqual([{ user_id: A }]);
    const own = (await db.query<{ id: string }>("select id from public.accounts")).rows[0].id;
    expect((await db.query("select id from public.account_balances")).rows).toEqual([{ id: own }]);
    await authenticate(B);
    expect((await db.query("select id from public.account_balances where id=$1", [own])).rows).toEqual([]);
  });
  it("interdit l'accès aux données d'authentification", async () => {
    await rejected(() => db.query("select * from auth.users"));
    await rejected(() => db.query("insert into auth.users(id) values($1)", [NEW]));
  });
  it.each(["agent_request_reservations", "app_connect_requests"])("ne permet pas de modifier le quota %s", async (table) => {
    await rejected(() => db.exec(`delete from public.${table}`));
    await rejected(() => db.exec(`truncate public.${table}`));
    await rejected(() => db.query(`insert into public.${table}(user_id) values($1)`, [A]));
  });
  it("retire les droits TRUNCATE et CREATE accordés lors d'une restauration permissive", async () => {
    await rejected(() => db.exec("truncate public.accounts"));
    await rejected(() => db.exec("create table public.untrusted(value text)"));
  });
  it("initialise un nouvel utilisateur avec un seul profil, compte et jeu de catégories", async () => {
    await authenticate(NEW);
    for (let i = 0; i < 3; i++) expect((await db.query("select public.ensure_app_user() as ok")).rows).toEqual([{ ok: true }]);
    expect((await db.query("select id,display_name,onboarding_completed_at from public.profiles")).rows).toEqual([{ id: NEW, display_name: "Camille", onboarding_completed_at: null }]);
    expect((await db.query("select count(*)::int as count from public.accounts")).rows).toEqual([{ count: 1 }]);
    expect((await db.query("select count(*)::int as count from public.categories")).rows).toEqual([{ count: 14 }]);
  });
  it("préserve les préférences d'un utilisateur existant", async () => {
    await db.exec("update public.profiles set display_name='Nom conservé',currency='USD'");
    await db.exec("select public.ensure_app_user()");
    expect((await db.query("select display_name,currency from public.profiles")).rows).toEqual([{ display_name: "Nom conservé", currency: "USD" }]);
    expect((await db.query("select count(*)::int as count from public.accounts")).rows).toEqual([{ count: 1 }]);
  });
  it("répare un profil manquant sans doubler les comptes ni les catégories", async () => {
    await db.exec("delete from public.profiles");
    await db.exec("select public.ensure_app_user()");
    expect((await db.query("select count(*)::int as count from public.accounts")).rows).toEqual([{ count: 1 }]);
    expect((await db.query("select count(*)::int as count from public.categories")).rows).toEqual([{ count: 14 }]);
  });
  it("refuse une initialisation sans identité", async () => {
    await authenticate("");
    await rejected(() => db.exec("select public.ensure_app_user()"));
  });
  it("bloque les lectures anonymes et l'initialisation anonyme", async () => {
    await db.exec("reset role; set local role anonymous");
    await rejected(() => db.exec("select * from public.profiles"));
    await rejected(() => db.exec("select public.ensure_app_user()"));
  });
  it("conserve les RPC OAuth après réapplication de la réparation", async () => {
    await db.exec("reset role");
    expect((await db.query(`select has_function_privilege('authenticated',
      'public.complete_app_oauth_connection(text,text,text,text,text,text,text,text,text,boolean)','EXECUTE') as complete,
      has_function_privilege('authenticated','public.reserve_app_connect_session()','EXECUTE') as quota`)).rows).toEqual([{ complete: true, quota: true }]);
  });
});
