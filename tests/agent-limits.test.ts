import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Supabase } from "@/lib/supabase/server";
import { checkUserLimit, LimitUnavailableError } from "@/lib/agents/limits";
import { applyMigration, createDatabase } from "./helpers/database";
import { POST } from "@/app/api/agents/route";

const routeMocks = vi.hoisted(() => ({ session: vi.fn(), ask: vi.fn(), space: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUserForApi: routeMocks.session }));
vi.mock("@/lib/agents/orchestrator", () => ({ askAgent: routeMocks.ask }));
vi.mock("@/lib/space", () => ({ getSpaceFilter: routeMocks.space }));

const USER_A = "30000000-0000-4000-8000-000000000001";
const USER_B = "30000000-0000-4000-8000-000000000002";
const migration = "20261017040000_agent_request_limits.sql";
type Reservation = {
  allowed: boolean;
  retry_after_seconds: number;
  limit_reason: "minute" | "day" | null;
  minute_count: number;
  day_count: number;
};

async function seedUsers(db: PGlite) {
  await db.query("insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')", [USER_A, USER_B]);
}

async function authenticate(db: PGlite, userId = USER_A) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
}

async function reserve(db: PGlite) {
  return (await db.query<Reservation>("select * from public.reserve_agent_request()" )).rows[0];
}

async function seedReservations(db: PGlite, count: number, age: string, userId = USER_A) {
  await db.query(`insert into public.agent_request_reservations (user_id, created_at)
    select $1::uuid, clock_timestamp() - interval '${age}' from generate_series(1, $2::integer)`, [userId, count]);
}

describe("atomic PostgreSQL AI request reservations", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createDatabase();
    await seedUsers(db);
    // Reproduce Supabase's permissive default grants on newly created tables.
    await db.exec("alter default privileges in schema public grant all on tables to anon, authenticated");
    await applyMigration(db, migration);
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("reset role; delete from public.agent_request_reservations");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  });
  afterEach(async () => { await db.exec("reset role"); });

  it("accepts exactly six of 25 submitted requests and keeps other users independent", async () => {
    await authenticate(db);
    // PGlite queues these queries on one backend. This tests the actual SQL under
    // parallel submissions; cross-session lock contention needs native PostgreSQL.
    const results = await Promise.all(Array.from({ length: 25 }, () => reserve(db)));
    expect(results.filter((result) => result.allowed)).toHaveLength(6);
    expect(results.filter((result) => !result.allowed)).toHaveLength(19);
    expect(results.slice(6).every((result) => result.limit_reason === "minute")).toBe(true);
    expect((await db.query("select id from public.agent_request_reservations")).rows).toHaveLength(6);
    await authenticate(db, USER_B);
    expect(await reserve(db)).toMatchObject({ allowed: true, minute_count: 1, day_count: 1 });
    expect((await db.query("select user_id from public.agent_request_reservations")).rows).toEqual([{ user_id: USER_B }]);
  });

  it("holds its user advisory lock until the transaction ends", async () => {
    await authenticate(db);
    await db.exec("begin");
    try {
      await reserve(db);
      const { rows } = await db.query("select locktype from pg_catalog.pg_locks where locktype = 'advisory' and granted");
      expect(rows).toHaveLength(1);
    } finally {
      await db.exec("rollback");
    }
    expect((await db.query("select locktype from pg_catalog.pg_locks where locktype = 'advisory' and granted")).rows).toEqual([]);
  });

  it("releases the minute window while keeping its reservations in the daily total", async () => {
    await seedReservations(db, 6, "61 seconds");
    await authenticate(db);
    expect(await reserve(db)).toMatchObject({ allowed: true, minute_count: 1, day_count: 7 });
  });

  it("accepts question 150 and denies question 151 in the rolling 24 hour window", async () => {
    await seedReservations(db, 149, "2 hours");
    await authenticate(db);
    expect(await reserve(db)).toMatchObject({ allowed: true, minute_count: 1, day_count: 150 });
    expect(await reserve(db)).toMatchObject({ allowed: false, limit_reason: "day", day_count: 150 });
    expect((await db.query("select id from public.agent_request_reservations")).rows).toHaveLength(150);
  });

  it("releases reservations after 24 hours and prunes only the current user's expired rows", async () => {
    await seedReservations(db, 150, "24 hours 1 minute");
    await seedReservations(db, 1, "24 hours 1 minute", USER_B);
    await authenticate(db);
    expect(await reserve(db)).toMatchObject({ allowed: true, minute_count: 1, day_count: 1 });
    await db.exec("reset role");
    expect((await db.query("select user_id from public.agent_request_reservations order by user_id")).rows)
      .toEqual([{ user_id: USER_A }, { user_id: USER_B }]);
  });

  it.each([
    { count: 6, age: "55 seconds", reason: "minute", min: 1, max: 5 },
    { count: 150, age: "23 hours 59 minutes 50 seconds", reason: "day", min: 1, max: 10 },
  ])("computes Retry-After from the actual $reason window", async ({ count, age, reason, min, max }) => {
    await seedReservations(db, count, age);
    await authenticate(db);
    const reservation = await reserve(db);
    expect(reservation).toMatchObject({ allowed: false, limit_reason: reason });
    expect(reservation.retry_after_seconds).toBeGreaterThanOrEqual(min);
    expect(reservation.retry_after_seconds).toBeLessThanOrEqual(max);
  });

  it.each([
    "insert into public.agent_request_reservations (user_id) values (auth.uid())",
    "update public.agent_request_reservations set created_at = now() - interval '2 days'",
    "delete from public.agent_request_reservations",
    "truncate public.agent_request_reservations",
  ])("forbids direct client mutation: %s", async (sql) => {
    await authenticate(db);
    await reserve(db);
    await expect(db.exec(sql)).rejects.toMatchObject({ code: "42501" });
    expect((await db.query("select id from public.agent_request_reservations")).rows).toHaveLength(1);
  });

  it("keeps reservations when a client deletes its editable messages", async () => {
    await authenticate(db);
    await db.exec(`insert into public.agent_messages (conversation_id, agent, role, content)
      values (gen_random_uuid(), 'finance', 'user', 'Question to delete')`);
    await reserve(db);
    await db.exec("delete from public.agent_messages");
    expect((await db.query("select id from public.agent_messages")).rows).toEqual([]);
    expect((await db.query("select id from public.agent_request_reservations")).rows).toHaveLength(1);
  });

  it("denies anonymous callers and rejects absent or nonexistent authenticated users", async () => {
    await db.exec("set role anon");
    await expect(reserve(db)).rejects.toMatchObject({ code: "42501" });
    await authenticate(db, "");
    await expect(reserve(db)).rejects.toMatchObject({ code: "42501" });
    await authenticate(db, "30000000-0000-0000-0000-000000000099");
    await expect(reserve(db)).rejects.toMatchObject({ code: "42501" });
  });

  it("uses the authenticated identity and rejects a caller-supplied identity", async () => {
    await authenticate(db);
    await expect(db.query("select * from public.reserve_agent_request($1::uuid)", [USER_B]))
      .rejects.toMatchObject({ code: "42883" });
    expect(await reserve(db)).toMatchObject({ allowed: true });
    expect((await db.query("select user_id from public.agent_request_reservations")).rows).toEqual([{ user_id: USER_A }]);
  });

  it("rejects a frozen transaction snapshot that could hide earlier reservations", async () => {
    await authenticate(db);
    await db.exec("begin isolation level repeatable read");
    try {
      await expect(reserve(db)).rejects.toMatchObject({ code: "25000" });
    } finally {
      await db.exec("rollback");
    }
  });

  it("cannot be redirected to a table in a caller-controlled search path", async () => {
    await authenticate(db);
    await db.exec("create temporary table agent_request_reservations (user_id uuid, created_at timestamptz); set search_path = pg_temp, public");
    try {
      expect(await reserve(db)).toMatchObject({ allowed: true, day_count: 1 });
      expect((await db.query("select * from pg_temp.agent_request_reservations")).rows).toEqual([]);
      expect((await db.query("select user_id from public.agent_request_reservations")).rows).toEqual([{ user_id: USER_A }]);
    } finally {
      await db.exec("reset search_path; drop table pg_temp.agent_request_reservations");
    }
  });
});

describe("quota migration history", () => {
  it("preserves recent user questions without importing assistant, old or future messages", async () => {
    const db = await createDatabase();
    try {
      await seedUsers(db);
      await db.query(`insert into public.agent_messages (user_id, conversation_id, agent, role, content, created_at)
        values ($1, gen_random_uuid(), 'finance', 'user', 'recent', now() - interval '1 minute'),
          ($1, gen_random_uuid(), 'finance', 'assistant', 'reply', now()),
          ($1, gen_random_uuid(), 'finance', 'user', 'old', now() - interval '25 hours'),
          ($1, gen_random_uuid(), 'finance', 'user', 'future', now() + interval '1 day')`, [USER_A]);
      await applyMigration(db, migration);
      expect((await db.query("select user_id from public.agent_request_reservations")).rows).toEqual([{ user_id: USER_A }]);
    } finally {
      await db.close();
    }
  }, 30_000);
});

describe("quota client and API failure handling", () => {
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); routeMocks.ask.mockReset(); });
  afterEach(() => { vi.restoreAllMocks(); });
  const allowed: Reservation = { allowed: true, retry_after_seconds: 0, limit_reason: null, minute_count: 1, day_count: 1 };
  const blocked: Reservation = { allowed: false, retry_after_seconds: 42, limit_reason: "minute", minute_count: 6, day_count: 6 };
  function client(response: unknown, error: unknown = null) {
    const rpc = vi.fn().mockResolvedValue({ data: response, error });
    return { rpc, supabase: { rpc } as unknown as Supabase };
  }

  it("reserves exactly once before accepting an AI request", async () => {
    const { rpc, supabase } = client([allowed]);
    expect(await checkUserLimit(supabase)).toEqual({ allowed: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("reserve_agent_request");
  });

  it("uses the database's Retry-After on a denied reservation", async () => {
    expect(await checkUserLimit(client([blocked]).supabase)).toMatchObject({ allowed: false, retryAfterSeconds: 42 });
  });

  it.each([null, [], [{}], [{ ...allowed, minute_count: 0, day_count: 0 }], [{ ...allowed, day_count: 151 }], [{ ...blocked, retry_after_seconds: 0 }]])(
    "fails closed on malformed quota data %#", async (data) => {
      await expect(checkUserLimit(client(data).supabase)).rejects.toBeInstanceOf(LimitUnavailableError);
    },
  );

  it("fails closed on database and transport errors", async () => {
    await expect(checkUserLimit(client(null, { code: "42P01" }).supabase)).rejects.toBeInstanceOf(LimitUnavailableError);
    const { supabase, rpc } = client(null);
    rpc.mockRejectedValueOnce(new Error("Network unavailable"));
    await expect(checkUserLimit(supabase)).rejects.toBeInstanceOf(LimitUnavailableError);
  });

  it.each([
    { data: null, error: { code: "42P01" }, status: 503, retry: "10" },
    { data: [blocked], error: null, status: 429, retry: "42" },
  ])("returns HTTP $status without running AI when reservation fails", async ({ data, error, status, retry }) => {
    routeMocks.session.mockResolvedValue({ supabase: client(data, error).supabase, userId: USER_A });
    const response = await POST(new Request("http://localhost/api/agents", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Mon solde", conversationId: USER_A }),
    }));
    expect(response.status).toBe(status);
    expect(response.headers.get("Retry-After")).toBe(retry);
    expect(routeMocks.ask).not.toHaveBeenCalled();
  });
});
