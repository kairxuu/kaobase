import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigration, createDatabase } from "./helpers/database";

const USER_A = "50000000-0000-4000-8000-000000000001";
const USER_B = "50000000-0000-4000-8000-000000000002";

type Setup = {
  displayName: string | null;
  currency: string | null;
  timezone: string | null;
  accountId: string | null;
  accountName: string | null;
  accountKind: string | null;
  openingBalance: string | null;
  space: string | null;
};

const initial: Setup = {
  displayName: "  Alex Martin  ", currency: "USD", timezone: "America/New_York", accountId: null,
  accountName: "  Mon compte  ", accountKind: "savings", openingBalance: "123.45", space: "pro",
};

async function authenticate(db: PGlite, userId = USER_A) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await db.exec("set local role authenticated");
}

async function complete(db: PGlite, overrides: Partial<Setup> = {}) {
  const value = { ...initial, ...overrides };
  return (await db.query<{ completed: boolean }>(
    "select public.complete_onboarding($1, $2, $3, $4::uuid, $5, $6, $7::numeric, $8) as completed",
    [value.displayName, value.currency, value.timezone, value.accountId,
      value.accountName, value.accountKind, value.openingBalance, value.space],
  )).rows[0].completed;
}

async function snapshot(db: PGlite) {
  const { rows } = await db.query<{ state: unknown }>(`select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'accounts', (select jsonb_agg(a order by a.created_at, a.id) from public.accounts a where a.user_id = auth.uid()),
    'transactions', (select jsonb_agg(t order by t.id) from public.transactions t where t.user_id = auth.uid())
  ) as state`);
  return rows[0].state;
}

async function expectRejected(db: PGlite, action: () => Promise<unknown>, code = "22023") {
  await db.exec("savepoint expected_rejection");
  try {
    await expect(action()).rejects.toMatchObject({ code });
  } finally {
    await db.exec("rollback to savepoint expected_rejection; release savepoint expected_rejection");
  }
}

describe("initial account configuration in PostgreSQL", () => {
  let db: PGlite;
  let accountA: string;
  let accountB: string;

  beforeAll(async () => {
    db = await createDatabase();
    // Seed before the migration to exercise existing users too.
    await db.query("insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')", [USER_A, USER_B]);
    accountA = (await db.query<{ id: string }>("select id from public.accounts where user_id = $1", [USER_A])).rows[0].id;
    accountB = (await db.query<{ id: string }>("select id from public.accounts where user_id = $1", [USER_B])).rows[0].id;
    await applyMigration(db, "20261017050000_onboarding.sql");
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("begin"); await authenticate(db); });
  afterEach(async () => { await db.exec("rollback; reset role"); });

  async function addTransaction() {
    await db.query(`insert into public.transactions (account_id, booked_at, amount, label_raw, merchant, dedupe_hash)
      values ($1, '2026-10-17', -42.50, 'Existing purchase', 'existing_purchase', $2)`, [accountA, randomUUID()]);
  }

  it("leaves existing profiles and newly registered users pending", async () => {
    expect((await db.query("select onboarding_completed_at from public.profiles")).rows)
      .toEqual([{ onboarding_completed_at: null }]);
    await db.exec("reset role");
    const newUser = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'new@example.test')", [newUser]);
    await authenticate(db, newUser);
    expect((await db.query("select onboarding_completed_at from public.profiles")).rows)
      .toEqual([{ onboarding_completed_at: null }]);
    expect((await db.query("select id from public.accounts")).rows).toHaveLength(1);
  });

  it("configures the signup account and profile together, trimming both names", async () => {
    expect(await complete(db)).toBe(true);
    expect((await db.query(`select id, name, kind, currency, opening_balance::text, space
      from public.accounts`)).rows).toEqual([{
      id: accountA, name: "Mon compte", kind: "savings", currency: "USD", opening_balance: "123.45", space: "pro",
    }]);
    expect((await db.query(`select display_name, currency, timezone, onboarding_completed_at is not null as completed
      from public.profiles`)).rows).toEqual([{
      display_name: "Alex Martin", currency: "USD", timezone: "America/New_York", completed: true,
    }]);
  });

  it("returns success on repeated submissions without changing data or adding accounts", async () => {
    await complete(db);
    const before = await snapshot(db);
    // PGlite queues on one backend; cross-session contention needs native PostgreSQL.
    expect(await Promise.all(Array.from({ length: 8 }, () => complete(db, {
      displayName: "Changed", accountId: accountB, openingBalance: "NaN", currency: "INVALID",
    })))).toEqual(Array(8).fill(true));
    expect(await snapshot(db)).toEqual(before);
  });

  it("chooses the oldest existing account when no account ID is supplied", async () => {
    await db.query("update public.accounts set created_at = '2026-01-01' where id = $1", [accountA]);
    const other = (await db.query<{ id: string }>(`insert into public.accounts (name, created_at)
      values ('Other account', '2026-02-01') returning id`)).rows[0].id;
    await complete(db);
    expect((await db.query("select id, name from public.accounts order by created_at")).rows).toEqual([
      { id: accountA, name: "Mon compte" }, { id: other, name: "Other account" },
    ]);
  });

  it("configures a supplied owned account without touching other accounts", async () => {
    const other = (await db.query<{ id: string }>("insert into public.accounts (name) values ('Other') returning id")).rows[0].id;
    await complete(db, { accountId: other });
    expect((await db.query("select id, name from public.accounts order by name")).rows).toEqual([
      { id: accountA, name: "Compte courant" }, { id: other, name: "Mon compte" },
    ]);
  });

  it("creates exactly one first account when a profile has none", async () => {
    await db.exec("delete from public.accounts");
    await complete(db);
    await complete(db);
    expect((await db.query("select name from public.accounts")).rows).toEqual([{ name: "Mon compte" }]);
  });

  it.each(["foreign", "nonexistent"])("rejects a %s account and leaves all data unchanged", async (kind) => {
    const before = await snapshot(db);
    await expectRejected(db, () => complete(db, { accountId: kind === "foreign" ? accountB : randomUUID() }), "42501");
    expect(await snapshot(db)).toEqual(before);
    await authenticate(db, USER_B);
    expect((await db.query("select name from public.accounts")).rows).toEqual([{ name: "Compte courant" }]);
    expect((await db.query("select onboarding_completed_at from public.profiles")).rows).toEqual([{ onboarding_completed_at: null }]);
  });

  it.each<Partial<Setup>>([
    { displayName: " " }, { displayName: "\t\n\r" }, { displayName: "x".repeat(61) }, { displayName: null },
    { currency: "BTC" }, { currency: null }, { timezone: "Mars/Olympus" }, { timezone: null },
    { accountName: " " }, { accountName: "\t\n\r" }, { accountName: "x".repeat(61) }, { accountName: null },
    { accountKind: "invalid" }, { accountKind: null }, { space: "all" }, { space: null },
    { openingBalance: null }, { openingBalance: "NaN" }, { openingBalance: "Infinity" },
    { openingBalance: "-Infinity" }, { openingBalance: "1000000000000" },
    { openingBalance: "-1000000000000" }, { openingBalance: "1.001" }, { openingBalance: "-1.001" },
  ])("rejects invalid configuration atomically: %j", async (invalid) => {
    const before = await snapshot(db);
    await expectRejected(db, () => complete(db, invalid));
    expect(await snapshot(db)).toEqual(before);
  });

  it.each(["EUR", "USD", "GBP", "CHF", "CAD", "MAD", "XOF", "XAF", "TND", "DZD"])(
    "accepts supported currency %s and UTC", async (currency) => {
      await complete(db, { currency, timezone: "UTC", openingBalance: "0" });
      expect((await db.query("select currency, timezone from public.profiles")).rows).toEqual([{ currency, timezone: "UTC" }]);
    },
  );

  it.each(["999999999999.99", "-999999999999.99", "1.2300"])("accepts exact supported amount %s", async (amount) => {
    await complete(db, { openingBalance: amount });
    expect((await db.query<{ amount: string }>("select opening_balance::text as amount from public.accounts")).rows[0].amount)
      .toBe(amount === "1.2300" ? "1.23" : amount);
  });

  it("preserves existing transactions, account currency, balance and space", async () => {
    await addTransaction();
    const before = (await db.query("select * from public.transactions")).rows;
    await complete(db, { accountId: accountA, openingBalance: "0.00", space: "perso", currency: "USD" });
    expect((await db.query(`select name, kind, currency, opening_balance::text, space from public.accounts`)).rows).toEqual([{
      name: "Mon compte", kind: "savings", currency: "EUR", opening_balance: "0.00", space: "perso",
    }]);
    expect((await db.query("select * from public.transactions")).rows).toEqual(before);
    expect((await db.query("select currency from public.profiles")).rows).toEqual([{ currency: "USD" }]);
  });

  it.each<Partial<Setup>>([{ openingBalance: "1", space: "perso" }, { openingBalance: "0", space: "pro" }])(
    "rejects rewriting a used account's financial settings: %j", async (change) => {
      await addTransaction();
      const before = await snapshot(db);
      await expectRejected(db, () => complete(db, change));
      expect(await snapshot(db)).toEqual(before);
    },
  );

  it.each([false, true])("rolls back account writes if marking the profile fails (new account: %s)", async (needsAccount) => {
    if (needsAccount) await db.exec("delete from public.accounts");
    const before = await snapshot(db);
    await db.exec(`reset role;
      create function public.reject_onboarding_test() returns trigger language plpgsql as $$
        begin raise exception 'Simulated final write failure' using errcode = '23514'; end;
      $$;
      create trigger reject_onboarding_test before update on public.profiles
        for each row execute function public.reject_onboarding_test()`);
    await authenticate(db);
    await expectRejected(db, () => complete(db), "23514");
    expect(await snapshot(db)).toEqual(before);
  });

  it("requires authentication, an existing profile and authenticated execute privileges", async () => {
    await authenticate(db, "");
    await expectRejected(db, () => complete(db), "42501");
    await authenticate(db, randomUUID());
    await expectRejected(db, () => complete(db), "42501");
    await db.exec("set local role anon");
    await expectRejected(db, () => complete(db), "42501");
    await db.exec("reset role");
    expect((await db.query(`select prosecdef from pg_catalog.pg_proc
      where oid = 'public.complete_onboarding(text,text,text,uuid,text,text,numeric,text)'::regprocedure`)).rows)
      .toEqual([{ prosecdef: false }]);
  });

  it("does not resolve profile or account tables through a caller-controlled search path", async () => {
    await db.exec("create temporary table profiles (id uuid); create temporary table accounts (name text); set local search_path = pg_temp, public");
    await complete(db);
    expect((await db.query("select * from pg_temp.profiles")).rows).toEqual([]);
    expect((await db.query("select * from pg_temp.accounts")).rows).toEqual([]);
    expect((await db.query("select onboarding_completed_at is not null as completed from public.profiles")).rows)
      .toEqual([{ completed: true }]);
  });
});
