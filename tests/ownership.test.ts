import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigration, createDatabase } from "./helpers/database";

const USER_A = "10000000-0000-0000-0000-000000000001";
const USER_B = "10000000-0000-0000-0000-000000000002";
const references = [
  { table: "imports", column: "account_id", parent: "accounts", cascade: false },
  { table: "transactions", column: "account_id", parent: "accounts", cascade: false },
  { table: "transactions", column: "category_id", parent: "categories", cascade: false },
  { table: "transactions", column: "import_id", parent: "imports", cascade: false },
  { table: "categorization_rules", column: "category_id", parent: "categories", cascade: true },
  { table: "subscriptions", column: "category_id", parent: "categories", cascade: false },
  { table: "tasks", column: "subscription_id", parent: "subscriptions", cascade: false },
  { table: "tasks", column: "transaction_id", parent: "transactions", cascade: false },
  { table: "agent_messages", column: "run_id", parent: "agent_runs", cascade: false },
  { table: "agent_feedback", column: "run_id", parent: "agent_runs", cascade: true },
  { table: "agent_examples", column: "run_id", parent: "agent_runs", cascade: false },
  { table: "budgets", column: "category_id", parent: "categories", cascade: true },
] as const;
type Reference = (typeof references)[number];

const parentTables = [...new Set(references.map((ref) => ref.parent))];
const parentIds = Object.fromEntries(parentTables.map((table) => [table, { a: randomUUID(), b: randomUUID() }]));

function requiredValues(table: string): Record<string, unknown> {
  const unique = randomUUID();
  switch (table) {
    case "accounts": return { name: unique };
    case "categories": return { name: unique };
    case "imports": return { filename: "test.csv", format: "csv" };
    case "transactions": return {
      booked_at: "2026-10-17", amount: -10, label_raw: "Test", merchant: unique, dedupe_hash: unique,
    };
    case "categorization_rules": return { merchant: unique, source: "user" };
    case "subscriptions": return { name: "Test", merchant: unique, amount: 10, period: "monthly" };
    case "tasks": return { title: "Test" };
    case "agent_runs": return { agent: "finance", input: "Test" };
    case "agent_messages": return { conversation_id: unique, agent: "finance", role: "user", content: "Test" };
    case "agent_feedback": return { rating: 1 };
    case "agent_examples": return { agent: "finance", input: "Test", output: "Test" };
    case "budgets": return { monthly_limit: 100 };
    default: throw new Error(`Unknown test table: ${table}`);
  }
}

async function insert(db: PGlite, table: string, values: Record<string, unknown>) {
  const columns = Object.keys(values);
  const result = await db.query<{ id: string }>(
    `insert into public.${table} (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(values),
  );
  return result.rows[0].id;
}

async function insertReference(db: PGlite, reference: Reference, owner: "a" | "b") {
  return insert(db, reference.table, {
    ...requiredValues(reference.table),
    user_id: USER_A,
    [reference.column]: parentIds[reference.parent][owner],
  });
}

async function seed(db: PGlite) {
  await db.query("insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')", [USER_A, USER_B]);
  for (const table of parentTables) {
    for (const [owner, userId] of [["a", USER_A], ["b", USER_B]] as const) {
      await insert(db, table, { ...requiredValues(table), user_id: userId, id: parentIds[table][owner] });
    }
  }
}

// PostgreSQL errors abort the transaction; a savepoint lets the test also inspect
// the unchanged row and exercise another operation after the expected rejection.
async function expectRejected(db: PGlite, action: () => Promise<unknown>, expected: Record<string, unknown>) {
  await db.exec("savepoint expected_rejection");
  try {
    await expect(action()).rejects.toMatchObject(expected);
  } finally {
    await db.exec("rollback to savepoint expected_rejection; release savepoint expected_rejection");
  }
}

describe("database ownership integrity", () => {
  let db: PGlite;
  beforeAll(async () => { db = await createDatabase(); await seed(db); }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback"); });

  it.each(references)("accepts own $table.$column and rejects foreign inserts and updates through RLS", async (ref) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [USER_A]);
    await db.exec("set local role authenticated");
    const id = await insertReference(db, ref, "a");

    await expectRejected(db, () => insertReference(db, ref, "b"), { code: "23503" });
    await expectRejected(db, () => db.query(`update public.${ref.table} set ${ref.column} = $1 where id = $2`, [
      parentIds[ref.parent].b, id,
    ]), { code: "23503" });
    const result = await db.query<{ user_id: string; reference: string }>(
      `select user_id, ${ref.column} as reference from public.${ref.table} where id = $1`, [id],
    );
    expect(result.rows).toEqual([{ user_id: USER_A, reference: parentIds[ref.parent].a }]);
  });

  it.each(references)("preserves deletion behavior for $table.$column", async (ref) => {
    const id = await insertReference(db, ref, "a");
    await db.query(`delete from public.${ref.parent} where id = $1`, [parentIds[ref.parent].a]);
    const result = await db.query<{ user_id: string; reference: null }>(
      `select user_id, ${ref.column} as reference from public.${ref.table} where id = $1`, [id],
    );
    expect(result.rows).toEqual(ref.cascade ? [] : [{ user_id: USER_A, reference: null }]);
  });

  it.each(parentTables)("prevents changing ownership of referenced %s, even when bypassing RLS", async (table) => {
    const ref = references.find((candidate) => candidate.parent === table)!;
    await insertReference(db, ref, "a");
    await expectRejected(db, () => db.query(`update public.${table} set user_id = $1 where id = $2`, [
      USER_B, parentIds[table].a,
    ]), { code: "23503" });
  });

  it("protects every business-to-business foreign key, including any future schema additions", async () => {
    const { rows } = await db.query<{ name: string; owner_checked: boolean; valid: boolean }>(`
      select constraint_row.conname as name, constraint_row.convalidated as valid,
        child_owner.attnum = any(constraint_row.conkey)
          and parent_owner.attnum = any(constraint_row.confkey) as owner_checked
      from pg_constraint constraint_row
      join pg_class child on child.oid = constraint_row.conrelid
      join pg_namespace child_schema on child_schema.oid = child.relnamespace
      join pg_attribute child_owner on child_owner.attrelid = child.oid and child_owner.attname = 'user_id'
      join pg_class parent on parent.oid = constraint_row.confrelid
      join pg_namespace parent_schema on parent_schema.oid = parent.relnamespace
      join pg_attribute parent_owner on parent_owner.attrelid = parent.oid and parent_owner.attname = 'user_id'
      where constraint_row.contype = 'f'
        and child_schema.nspname = 'public' and parent_schema.nspname = 'public'
    `);
    expect(rows.length).toBe(references.length);
    for (const row of rows) expect(row, row.name).toMatchObject({ owner_checked: true, valid: true });
  });
});

describe("ownership migration with previously invalid references", () => {
  let db: PGlite;
  beforeAll(async () => { db = await createDatabase({ ownership: false }); await seed(db); }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback"); });

  it.each(references)("stops atomically without changing invalid $table.$column", async (ref) => {
    const id = await insertReference(db, ref, "b");
    await expectRejected(db, () => applyMigration(db, "20261017010000_ownership_integrity.sql"), {
      code: "23514",
      detail: `${ref.table}.${ref.column}: 1`,
    });
    const result = await db.query<{ user_id: string; reference: string }>(
      `select user_id, ${ref.column} as reference from public.${ref.table} where id = $1`, [id],
    );
    expect(result.rows).toEqual([{ user_id: USER_A, reference: parentIds[ref.parent].b }]);
    const { rows } = await db.query<{ column_count: number }>(
      "select cardinality(conkey) as column_count from pg_constraint where conname = $1",
      [`${ref.table}_${ref.column}_fkey`],
    );
    expect(rows).toEqual([{ column_count: 1 }]);
    const uniqueConstraints = await db.query("select conname from pg_constraint where conname like '%_user_id_id_key'");
    expect(uniqueConstraints.rows).toEqual([]);
  });
});
