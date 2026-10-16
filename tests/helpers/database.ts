import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

export async function applyMigration(db: PGlite, filename: string) {
  const sql = await readFile(new URL(`../../supabase/migrations/${filename}`, import.meta.url), "utf8");
  await db.exec(sql);
}

/** Real project migrations on local PostgreSQL WASM; no credentials or network. */
export async function createDatabase({ ownership = true } = {}) {
  const db = new PGlite({ extensions: { vector } });
  try {
    await db.exec(`
      create schema auth;
      create schema extensions;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table auth.users (
        id uuid primary key,
        email text,
        raw_user_meta_data jsonb not null default '{}'::jsonb
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth, public, extensions to anon, authenticated, service_role;
    `);
    for (const migration of [
      "20261015000000_init.sql",
      "20261015120000_budgets.sql",
      "20261016000000_spaces.sql",
      ...(ownership ? ["20261017010000_ownership_integrity.sql"] : []),
    ]) {
      await applyMigration(db, migration);
    }
    await db.exec("grant all on all tables in schema public to authenticated, service_role");
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
