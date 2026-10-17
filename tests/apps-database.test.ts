import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigration, createDatabase } from "./helpers/database";

const USER_A = "60000000-0000-4000-8000-000000000001";
const USER_B = "60000000-0000-4000-8000-000000000002";

async function authenticate(db: PGlite, userId = USER_A) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await db.exec("set local role authenticated");
}

async function expectRejected(db: PGlite, action: () => Promise<unknown>, code: string) {
  await db.exec("savepoint expected_rejection");
  try {
    await expect(action()).rejects.toMatchObject({ code });
  } finally {
    await db.exec("rollback to savepoint expected_rejection; release savepoint expected_rejection");
  }
}

describe("private application shortcuts in PostgreSQL", () => {
  let db: PGlite;
  let ownId: string;
  let foreignId: string;

  beforeAll(async () => {
    db = await createDatabase();
    await db.query("insert into auth.users (id, email) values ($1, 'apps-a@example.test'), ($2, 'apps-b@example.test')", [USER_A, USER_B]);
    await applyMigration(db, "20261017060000_app_shortcuts.sql");
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("begin");
    await authenticate(db, USER_B);
    foreignId = (await db.query<{ id: string }>(`insert into public.app_shortcuts (name, url)
      values ('Private B', 'https://example.test/b') returning id`)).rows[0].id;
    await authenticate(db);
    ownId = (await db.query<{ id: string }>(`insert into public.app_shortcuts (name, url, updated_at)
      values ('My app', 'https://example.test/', '2000-01-01') returning id`)).rows[0].id;
  });
  afterEach(async () => { await db.exec("rollback; reset role"); });

  it("assigns the authenticated owner and defaults, and supports creating, updating and deleting own shortcuts", async () => {
    const original = (await db.query<{ updated_at: Date }>(`select user_id, name, url, account_label, category, space, pinned,
      created_at, updated_at from public.app_shortcuts`)).rows[0];
    expect(original).toMatchObject({
      user_id: USER_A, name: "My app", url: "https://example.test/", account_label: "",
      category: "other", space: "perso", pinned: true,
    });
    const updated = (await db.query<{ updated_at: Date }>(`update public.app_shortcuts
      set name = 'My work account', account_label = 'alex@example.test', category = 'work', space = 'pro', pinned = false
      where id = $1 returning updated_at`, [ownId])).rows[0];
    expect(updated.updated_at.getTime()).toBeGreaterThan(original.updated_at.getTime());
    expect((await db.query(`select name, account_label, category, space, pinned from public.app_shortcuts`)).rows)
      .toEqual([{ name: "My work account", account_label: "alex@example.test", category: "work", space: "pro", pinned: false }]);
    expect((await db.query("delete from public.app_shortcuts where id = $1 returning id", [ownId])).rows)
      .toEqual([{ id: ownId }]);
    expect((await db.query("select id from public.app_shortcuts")).rows).toEqual([]);
  });

  it("hides other users' shortcuts and prevents editing or deleting them", async () => {
    expect((await db.query("select id from public.app_shortcuts order by id")).rows).toEqual([{ id: ownId }]);
    expect((await db.query("select id from public.app_shortcuts where id = $1", [foreignId])).rows).toEqual([]);
    expect((await db.query("update public.app_shortcuts set name = 'Stolen' where id = $1 returning id", [foreignId])).rows).toEqual([]);
    expect((await db.query("delete from public.app_shortcuts where id = $1 returning id", [foreignId])).rows).toEqual([]);
    await authenticate(db, USER_B);
    expect((await db.query("select id, name from public.app_shortcuts")).rows).toEqual([{ id: foreignId, name: "Private B" }]);
  });

  it("rejects inserting for another user and transferring an owned shortcut", async () => {
    await expectRejected(db, () => db.query(`insert into public.app_shortcuts (user_id, name, url)
      values ($1, 'Injected', 'https://example.test/injected')`, [USER_B]), "42501");
    await expectRejected(db, () => db.query("update public.app_shortcuts set user_id = $1 where id = $2", [USER_B, ownId]), "42501");
  });

  it("rejects unauthenticated access even with the authenticated role", async () => {
    await authenticate(db, "");
    expect((await db.query("select id from public.app_shortcuts")).rows).toEqual([]);
    await expectRejected(db, () => db.query(`insert into public.app_shortcuts (name, url)
      values ('No session', 'https://example.test/no-session')`), "42501");
  });

  it("grants authenticated CRUD only and no anonymous table access", async () => {
    await db.exec("set local role anon");
    for (const statement of [
      "select id from public.app_shortcuts",
      "insert into public.app_shortcuts (name, url) values ('Anon', 'https://example.test/anon')",
      "update public.app_shortcuts set pinned = false",
      "delete from public.app_shortcuts",
    ]) {
      await expectRejected(db, () => db.exec(statement), "42501");
    }
    await authenticate(db);
    await expectRejected(db, () => db.exec("truncate table public.app_shortcuts"), "42501");
  });

  it("allows several accounts for one app and separate spaces but rejects the same account twice", async () => {
    await db.query(`insert into public.app_shortcuts (name, url, account_label) values
      ('My app private', 'https://example.test/', 'private@example.test'),
      ('My app professional', 'https://example.test/', 'work@example.test')`);
    await db.query(`insert into public.app_shortcuts (name, url, space)
      values ('My app pro space', 'https://example.test/', 'pro')`);
    expect((await db.query("select id from public.app_shortcuts")).rows).toHaveLength(4);
    await expectRejected(db, () => db.query(`insert into public.app_shortcuts (name, url)
      values ('Duplicate', 'https://example.test/')`), "23505");
    await expectRejected(db, () => db.query(`update public.app_shortcuts set account_label = ''
      where account_label = 'private@example.test'`), "23505");
    await authenticate(db, USER_B);
    await db.query(`insert into public.app_shortcuts (name, url) values ('Same app for B', 'https://example.test/')`);
    expect((await db.query("select id from public.app_shortcuts")).rows).toHaveLength(2);
  });

  it.each([
    ["name", ""], ["name", " "], ["name", "\t\n"], ["name", " Untrimmed"],
    ["name", "x".repeat(81)], ["name", "Hidden\nname"],
    ["account_label", "x".repeat(161)], ["account_label", " email@example.test "], ["account_label", "abc\tdef"],
    ["category", "unknown"], ["space", "all"],
    ["url", ""], ["url", "javascript:alert(1)"], ["url", "data:text/html,test"],
    ["url", "ftp://example.test/"], ["url", "//example.test/"], ["url", "https://"],
    ["url", "https:///example.test"], ["url", "https://?query"], ["url", "https://#fragment"],
    ["url", "https://user@example.test/"], ["url", "https://user:secret@example.test/"],
    ["url", "https://example.test/\nfoo"], ["url", "https://example.test/\rfoo"],
    ["url", "https://example.test/\tfoo"], ["url", "https://example.test/\u007ffoo"],
    ["url", " https://example.test/"], ["url", "https://example.test/path with space"],
    ["url", "https://example.test\\other"], ["url", "https://example.test/\\other"],
    ["url", `https://example.test/${"x".repeat(2048)}`],
  ])("rejects invalid %s value %j", async (field, value) => {
    // Column names are a fixed test list, values remain query parameters.
    await expectRejected(db, () => db.query(`update public.app_shortcuts set ${field} = $1 where id = $2`, [value, ownId]), "23514");
  });

  it.each(["http://localhost:3000/", "https://example.test/path?q=a%20b#account", "https://[::1]:3000/path", "https://example.test/@account"])(
    "accepts safe HTTP(S) address %s", async (url) => {
      await db.query("update public.app_shortcuts set url = $1 where id = $2", [url, ownId]);
      expect((await db.query("select url from public.app_shortcuts")).rows).toEqual([{ url }]);
    },
  );

  it("supports every category and maximum name and account label lengths", async () => {
    for (const category of ["banking", "work", "communication", "shopping", "entertainment", "other"]) {
      await db.query("update public.app_shortcuts set category = $1, name = $2, account_label = $3 where id = $4",
        [category, "É".repeat(80), "é".repeat(160), ownId]);
    }
    expect((await db.query("select category from public.app_shortcuts")).rows).toEqual([{ category: "other" }]);
  });

  it.each(["user_id", "name", "url", "account_label", "category", "space", "pinned", "created_at"])(
    "requires non-null %s", async (field) => {
      await db.exec("reset role");
      await expectRejected(db, () => db.query(`update public.app_shortcuts set ${field} = null where id = $1`, [ownId]), "23502");
    },
  );

  it("deletes shortcuts when their owner account is deleted and keeps another user's data", async () => {
    await db.exec("reset role");
    await db.query("delete from auth.users where id = $1", [USER_A]);
    expect((await db.query("select id from public.app_shortcuts")).rows).toEqual([{ id: foreignId }]);
  });

  it("enforces the auth user foreign key for privileged writes too", async () => {
    await db.exec("reset role");
    await expectRejected(db, () => db.query(`insert into public.app_shortcuts (user_id, name, url)
      values ($1, 'Missing user', 'https://example.test/missing')`, [randomUUID()]), "23503");
  });
});
