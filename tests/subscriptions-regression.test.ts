import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Supabase } from "@/lib/supabase/server";
import { createSubscription, listSubscriptions, runSubscriptionDetection, updateSubscription } from "@/lib/data/subscriptions";
import { addPeriod, detectSubscriptions, rollForward } from "@/lib/learning/subscriptions";
import { forecastBalance } from "@/lib/learning/forecast";
import { applyMigration, createDatabase } from "./helpers/database";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
type Operation = "select" | "insert" | "upsert" | "update";
type Request = { table: string; operation: Operation; values?: Row; options?: Row; filters: [string, unknown][] };

// Modèle Supabase en mémoire : les filtres sont exécutés au moment de la requête,
// ce qui vérifie aussi le verrou de modification utilisateur concurrente.
function database(initial: Record<string, Row[]>) {
  const tables = structuredClone(initial);
  const requests: Request[] = [];
  const failures = new Map<string, Error>();
  let beforeUpdate: (() => void) | undefined;

  const client = {
    from(table: string) {
      const request: Request = { table, operation: "select", filters: [] };
      requests.push(request);
      let single = false;
      const query = {
        select: () => query,
        lt: () => query,
        gte: () => query,
        limit: () => query,
        order: () => query,
        in(column: string, values: unknown[]) { request.filters.push([column, values]); return query; },
        eq(column: string, value: unknown) { request.filters.push([column, value]); return query; },
        insert(values: Row) { request.operation = "insert"; request.values = values; return query; },
        upsert(values: Row, options: Row) { request.operation = "upsert"; request.values = values; request.options = options; return query; },
        update(values: Row) { request.operation = "update"; request.values = values; return query; },
        single() { single = true; return query; },
        then(resolve: (result: { data: Row[] | Row | null; error: Error | null }) => unknown) {
          const error = failures.get(`${table}:${request.operation}`) ?? null;
          if (error) return Promise.resolve(resolve({ data: null, error }));
          if (request.operation === "update") beforeUpdate?.();
          const rows = tables[table] ??= [];
          const matches = (row: Row) => request.filters.every(([key, value]) =>
            Array.isArray(value) ? value.includes(row[key]) : row[key] === value,
          );
          let data: Row[];
          if (request.operation === "select") {
            data = rows.filter(matches);
          } else if (request.operation === "update") {
            data = rows.filter(matches);
            for (const row of data) Object.assign(row, request.values);
          } else {
            const duplicate = request.operation === "upsert" && rows.some((row) =>
              row.space === request.values?.space && row.merchant === request.values?.merchant,
            );
            data = duplicate ? [] : [{ id: `created-${rows.length}`, ...request.values }];
            rows.push(...data);
          }
          return Promise.resolve(resolve({ data: structuredClone(single ? data[0] : data), error: null }));
        },
      };
      return query;
    },
  };
  return {
    client: client as unknown as Supabase,
    tables,
    requests,
    failures,
    beforeUpdate(callback: () => void) { beforeUpdate = callback; },
  };
}

function payments(accountId: string, amount = 10, categoryId = "personal-category") {
  return ["2026-07-10", "2026-08-10", "2026-09-10", "2026-10-10"].map((booked_at) => ({
    booked_at, amount: -amount, merchant: "CLOUD", category_id: categoryId, account_id: accountId,
  }));
}

function fixtures(subscriptions: Row[] = []) {
  return database({
    accounts: [{ id: "personal", space: "perso" }, { id: "work", space: "pro" }],
    transactions: payments("personal"),
    subscriptions,
  });
}

describe("détection des abonnements : espaces, choix utilisateur et erreurs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("crée deux abonnements distincts pour un marchand perso/pro avec leurs montants et catégories", async () => {
    const db = fixtures();
    db.tables.transactions.push(...payments("work", 80, "work-category"));

    expect(await runSubscriptionDetection(db.client)).toEqual({ detected: 2, created: 2, updated: 0 });
    expect(db.tables.subscriptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ merchant: "CLOUD", space: "perso", amount: 10, category_id: "personal-category", detection_managed: true }),
      expect.objectContaining({ merchant: "CLOUD", space: "pro", amount: 80, category_id: "work-category", detection_managed: true }),
    ]));
    expect(db.requests.filter((r) => r.operation === "upsert").every((r) =>
      r.options?.onConflict === "user_id,space,merchant" && r.options?.ignoreDuplicates === true,
    )).toBe(true);
  });

  it.each(["rejected", "cancelled"])("un abonnement %s en perso ne masque pas celui en pro", async (status) => {
    const db = fixtures([{ id: "existing", merchant: "CLOUD", status, space: "perso" }]);
    db.tables.transactions.push(...payments("work", 80));

    expect(await runSubscriptionDetection(db.client)).toEqual({ detected: 1, created: 1, updated: 0 });
    expect(db.tables.subscriptions).toHaveLength(2);
    expect(db.tables.subscriptions[1]).toMatchObject({ space: "pro", amount: 80 });
  });

  it.each([
    { status: "active", detection_managed: true },
    { status: "suggested", detection_managed: false },
    { status: "suggested" },
  ])("préserve un abonnement confirmé, modifié ou historique : %j", async (state) => {
    const original = {
      id: "existing", merchant: "CLOUD", space: "perso", amount: 25, period: "yearly", next_due: "2027-04-01", ...state,
    };
    const db = fixtures([original]);

    expect(await runSubscriptionDetection(db.client)).toEqual({ detected: 1, created: 0, updated: 0 });
    expect(db.tables.subscriptions[0]).toEqual(original);
  });

  it("protège les changements utilisateur dès leur enregistrement", async () => {
    const db = fixtures([{ id: "existing", merchant: "CLOUD", space: "perso", status: "suggested", detection_managed: true }]);
    await updateSubscription(db.client, "existing", { amount: 25, period: "yearly", next_due: "2027-04-01", notes: "Contrat modifié" });
    expect(await runSubscriptionDetection(db.client)).toEqual({ detected: 1, created: 0, updated: 0 });
    expect(db.tables.subscriptions[0]).toMatchObject({
      amount: 25, period: "yearly", next_due: "2027-04-01", anchor_day: 1, notes: "Contrat modifié", detection_managed: false,
    });
  });

  it("rafraîchit une suggestion non modifiée", async () => {
    const db = fixtures([{ id: "existing", merchant: "CLOUD", space: "perso", status: "suggested", amount: 8, detection_managed: true }]);

    expect(await runSubscriptionDetection(db.client)).toEqual({ detected: 1, created: 0, updated: 1 });
    expect(db.tables.subscriptions[0]).toMatchObject({ amount: 10, period: "monthly", next_due: "2026-11-10" });
  });

  it("préserve une modification arrivée entre la lecture et la mise à jour automatique", async () => {
    const db = fixtures([{ id: "existing", merchant: "CLOUD", space: "perso", status: "suggested", amount: 8, detection_managed: true }]);
    db.beforeUpdate(() => Object.assign(db.tables.subscriptions[0], { amount: 25, detection_managed: false }));

    expect(await runSubscriptionDetection(db.client)).toEqual({ detected: 1, created: 0, updated: 0 });
    expect(db.tables.subscriptions[0].amount).toBe(25);
  });

  it("ne place pas un ajout manuel sous le contrôle du détecteur", async () => {
    const db = fixtures();
    await createSubscription(db.client, { name: "Cloud", amount: 25, period: "yearly", nextDue: "2027-04-01" });

    expect(await runSubscriptionDetection(db.client)).toEqual({ detected: 1, created: 0, updated: 0 });
    expect(db.tables.subscriptions[0]).toMatchObject({ amount: 25, detection_managed: false, status: "active" });
  });

  it.each([30, 31])("conserve l'ancre %i de la base à l'affichage puis à la prévision", async (anchorDay) => {
    vi.setSystemTime(new Date("2026-02-03T12:00:00Z"));
    const db = fixtures([{
      id: "existing", merchant: "CLOUD", space: "perso", status: "active", amount: 10,
      period: "monthly", next_due: `2026-01-${anchorDay}`, anchor_day: anchorDay,
    }]);
    const [subscription] = await listSubscriptions(db.client);
    expect(subscription.next_due).toBe("2026-02-28");
    const result = forecastBalance({
      today: "2026-02-03", balance: 1000, horizonDays: 56,
      subscriptions: [{
        merchant: subscription.merchant, amount: subscription.amount, period: subscription.period,
        nextDue: subscription.next_due, anchorDay: subscription.anchor_day,
      }],
      recentTransactions: [],
    });
    expect(result.points.find((point) => point.date === "2026-03-28")?.balance).toBe(990);
    expect(result.points.find((point) => point.date === `2026-03-${anchorDay}`)?.balance).toBe(980);
    expect(db.tables.subscriptions[0].next_due).toBe(`2026-01-${anchorDay}`);
  });

  it("ne réinitialise pas l'ancre quand le formulaire réenvoie la date affichée d'un mois court", async () => {
    vi.setSystemTime(new Date("2026-02-03T12:00:00Z"));
    const db = fixtures([{
      id: "existing", merchant: "CLOUD", space: "perso", status: "active", amount: 10,
      period: "monthly", next_due: "2026-01-31", anchor_day: 31,
    }]);
    await updateSubscription(db.client, "existing", { next_due: "2026-02-28", period: "monthly", amount: 25 });
    expect(db.tables.subscriptions[0]).toMatchObject({ next_due: "2026-02-28", anchor_day: 31, amount: 25 });
    await updateSubscription(db.client, "existing", { next_due: "2026-02-25" });
    expect(db.tables.subscriptions[0]).toMatchObject({ next_due: "2026-02-25", anchor_day: 25 });
    await updateSubscription(db.client, "existing", { next_due: null });
    expect(db.tables.subscriptions[0]).toMatchObject({ next_due: null, anchor_day: null });
  });

  it.each(["transactions", "subscriptions", "accounts"])("interrompt toute écriture si la lecture %s échoue", async (table) => {
    const db = fixtures();
    const failure = new Error("read failed");
    db.failures.set(`${table}:select`, failure);

    await expect(runSubscriptionDetection(db.client)).rejects.toBe(failure);
    expect(db.requests.every((r) => r.operation === "select")).toBe(true);
  });

  it.each(["update", "upsert"])("remonte une erreur %s au lieu d'annoncer un succès", async (operation) => {
    const db = fixtures(operation === "update"
      ? [{ id: "existing", merchant: "CLOUD", space: "perso", status: "suggested", detection_managed: true }]
      : []);
    const failure = new Error("write failed");
    db.failures.set(`subscriptions:${operation}`, failure);

    await expect(runSubscriptionDetection(db.client)).rejects.toBe(failure);
  });
});

describe("échéances calendaires sans dérive", () => {
  it("rétablit le jour d'origine après un mois court, y compris pour les années bissextiles", () => {
    expect(rollForward("2026-01-31", "monthly", "2026-03-01")).toBe("2026-03-31");
    expect(rollForward("2026-01-30", "monthly", "2026-03-01")).toBe("2026-03-30");
    expect(rollForward("2025-11-30", "quarterly", "2026-03-01")).toBe("2026-05-30");
    expect(rollForward("2024-02-29", "yearly", "2028-02-01")).toBe("2028-02-29");
  });

  it("calcule chaque échéance de prévision depuis la date d'origine", () => {
    const result = forecastBalance({
      today: "2026-01-31", balance: 1000, horizonDays: 90,
      subscriptions: [{ merchant: "CLOUD", amount: 10, period: "monthly", nextDue: "2026-01-31" }],
      recentTransactions: [],
    });
    const chargeDates = result.points.filter((point, i, points) =>
      point.balance < (i === 0 ? 1000 : points[i - 1].balance),
    ).map((point) => point.date);
    expect(chargeDates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(result.subscriptionsTotal).toBe(40);
  });

  it("ne perd pas le jour d'origine quand la prévision rattrape plusieurs échéances passées", () => {
    const result = forecastBalance({
      today: "2026-03-01", balance: 1000, horizonDays: 30,
      subscriptions: [{ merchant: "CLOUD", amount: 10, period: "monthly", nextDue: "2026-01-31" }],
      recentTransactions: [],
    });
    expect(result.points.find((point) => point.date === "2026-03-28")?.balance).toBe(1000);
    expect(result.points.at(-1)).toEqual({ date: "2026-03-31", balance: 990 });
  });

  it("ne décale pas une suggestion du 31 vers le 28 lors du rattrapage", () => {
    const transactions = ["2025-10-31", "2025-11-30", "2025-12-31", "2026-01-31"].map((bookedAt) => ({
      merchant: "CLOUD", amount: -10, bookedAt,
    }));
    expect(detectSubscriptions(transactions, { today: "2026-03-01" })[0]?.nextDue).toBe("2026-03-31");
    expect(addPeriod("2026-01-31", "monthly", 2)).toBe("2026-03-31");
  });

  it("retrouve l'ancre de fin de mois même si le dernier paiement tombe en février", () => {
    const transactions = ["2025-12-31", "2026-01-31", "2026-02-28"].map((bookedAt) => ({
      merchant: "CLOUD", amount: -10, bookedAt,
    }));
    expect(detectSubscriptions(transactions, { today: "2026-03-01" })[0]).toMatchObject({
      nextDue: "2026-03-31", anchorDay: 31,
    });
  });
});

describe("migration d'identité des abonnements", () => {
  it("préserve les lignes historiques, autorise le même marchand par espace et contraint son ancre", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'test@example.invalid');
        insert into public.subscriptions (id, user_id, name, merchant, amount, period, next_due)
        values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
          'Cloud perso', 'CLOUD', 10, 'monthly', '2026-01-31');
      `);
      await applyMigration(db, "20261017020000_subscription_identity.sql");
      const legacy = await db.query("select id, space, detection_managed, anchor_day, next_due::text from public.subscriptions");
      expect(legacy.rows).toEqual([{
        id: "22222222-2222-4222-8222-222222222222", space: "perso", detection_managed: false,
        anchor_day: 31, next_due: "2026-01-31",
      }]);
      await db.exec(`
        insert into public.subscriptions (user_id, name, merchant, amount, period, space, anchor_day)
        values ('11111111-1111-4111-8111-111111111111', 'Cloud pro', 'CLOUD', 80, 'monthly', 'pro', 31);
      `);
      expect((await db.query("select count(*)::int as total from public.subscriptions")).rows).toEqual([{ total: 2 }]);
      await expect(db.exec(`
        insert into public.subscriptions (user_id, name, merchant, amount, period, space)
        values ('11111111-1111-4111-8111-111111111111', 'Doublon', 'CLOUD', 10, 'monthly', 'perso');
      `)).rejects.toMatchObject({ code: "23505" });
      await expect(db.exec("update public.subscriptions set anchor_day = 32")).rejects.toMatchObject({ code: "23514" });
    } finally {
      await db.close();
    }
  }, 20000);
});
