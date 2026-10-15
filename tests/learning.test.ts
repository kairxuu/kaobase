import { describe, expect, it } from "vitest";
import { addPeriod, annualCost, detectSubscriptions, rollForward } from "@/lib/learning/subscriptions";
import { applicableRule, groupAssignments, learnFromLlm, learnFromUser, ruleConfidence } from "@/lib/learning/rules";
import { forecastBalance } from "@/lib/learning/forecast";
import { routeByKeywords } from "@/lib/learning/router";

function monthly(merchant: string, amount: number, start: string, count: number, jitter = 0) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(addPeriod(start, "monthly", i) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + (i % 2 ? jitter : 0));
    return { merchant, amount: -amount, bookedAt: d.toISOString().slice(0, 10) };
  });
}

describe("detectSubscriptions", () => {
  const today = "2026-07-10";

  it("détecte un abonnement mensuel régulier, même avec quelques jours d'écart", () => {
    const txs = [...monthly("NETFLIX", 13.49, "2026-01-05", 6, 2)];
    const [sub] = detectSubscriptions(txs, { today });
    expect(sub).toMatchObject({ merchant: "NETFLIX", period: "monthly", amount: 13.49, occurrences: 6 });
    expect(sub.confidence).toBeGreaterThan(0.9);
    expect(sub.nextDue >= today).toBe(true);
  });

  it("ignore les achats irréguliers et les revenus", () => {
    const txs = [
      { merchant: "CARREFOUR", amount: -54, bookedAt: "2026-01-03" },
      { merchant: "CARREFOUR", amount: -12, bookedAt: "2026-01-09" },
      { merchant: "CARREFOUR", amount: -88, bookedAt: "2026-02-21" },
      { merchant: "CARREFOUR", amount: -31, bookedAt: "2026-02-23" },
      ...monthly("SALAIRE", -2100, "2026-01-28", 6),
    ];
    expect(detectSubscriptions(txs, { today })).toEqual([]);
  });

  it("détecte un abonnement annuel et respecte les exclusions", () => {
    const txs = [
      { merchant: "AMAZON PRIME", amount: -69.9, bookedAt: "2024-03-01" },
      { merchant: "AMAZON PRIME", amount: -69.9, bookedAt: "2025-03-01" },
      { merchant: "AMAZON PRIME", amount: -69.9, bookedAt: "2026-03-02" },
    ];
    expect(detectSubscriptions(txs, { today })[0]).toMatchObject({ period: "yearly", nextDue: "2027-03-02" });
    expect(detectSubscriptions(txs, { today, exclude: new Set(["AMAZON PRIME"]) })).toEqual([]);
  });

  it("pénalise un abonnement arrêté depuis longtemps", () => {
    const txs = monthly("GYM", 30, "2025-01-10", 5);
    expect(detectSubscriptions(txs, { today })).toEqual([]);
  });

  it("calcule le coût annuel", () => {
    expect(annualCost(10, "monthly")).toBe(120);
    expect(annualCost(5, "weekly")).toBeCloseTo(260.89, 1);
  });
});

describe("règles apprises", () => {
  it("une correction utilisateur crée une règle applicable", () => {
    const rule = learnFromUser(undefined, "NETFLIX", "abos");
    expect(ruleConfidence(rule)).toBeCloseTo(0.667, 2);
    expect(applicableRule(rule)).toBeDefined();
  });

  it("une confirmation renforce, une contradiction remplace une règle LLM", () => {
    const llm = learnFromLlm(undefined, "UBER", "transport")!;
    expect(ruleConfidence(llm)).toBe(0.5);
    const corrected = learnFromUser(llm, "UBER", "restaurants");
    expect(corrected).toMatchObject({ categoryId: "restaurants", source: "user", hits: 1, misses: 0 });
    const confirmed = learnFromUser(corrected, "UBER", "restaurants");
    expect(confirmed.hits).toBe(2);
  });

  it("une règle utilisateur solide résiste à une contradiction isolée", () => {
    const solid = { merchant: "SNCF", categoryId: "transport", source: "user" as const, hits: 4, misses: 0 };
    const after = learnFromUser(solid, "SNCF", "loisirs");
    expect(after).toMatchObject({ categoryId: "transport", misses: 1 });
  });

  it("le LLM n'écrase jamais une règle existante", () => {
    expect(learnFromLlm(learnFromUser(undefined, "X", "a"), "X", "b")).toBeUndefined();
  });
});

describe("forecastBalance", () => {
  it("projette solde, abonnements et tendance variable", () => {
    const result = forecastBalance({
      today: "2026-07-01",
      balance: 1000,
      horizonDays: 30,
      subscriptions: [{ merchant: "NETFLIX", amount: 13.49, period: "monthly", nextDue: "2026-07-05" }],
      recentTransactions: [
        { bookedAt: "2026-04-03", amount: -300, merchant: "CARREFOUR" },
        { bookedAt: "2026-06-30", amount: -600, merchant: "CARREFOUR" },
        { bookedAt: "2026-06-05", amount: -13.49, merchant: "NETFLIX" },
      ],
    });
    expect(result.variableDaily).toBe(-10);
    expect(result.subscriptionsTotal).toBe(13.49);
    expect(result.points).toHaveLength(31);
    expect(result.points.at(-1)!.balance).toBeCloseTo(1000 - 300 - 13.49, 2);
  });
});

describe("routeByKeywords", () => {
  it("route vers le bon secteur", () => {
    expect(routeByKeywords("Combien j'ai dépensé en restaurants ce mois ?").agent).toBe("finance");
    expect(routeByKeywords("Quels abonnements je pourrais résilier ?").agent).toBe("subscriptions");
    expect(routeByKeywords("Ajoute une tâche pour appeler la banque demain").agent).toBe("tasks");
    expect(routeByKeywords("J'ai des doublons dans mon import CSV").agent).toBe("imports");
  });
  it("renvoie null si ambigu", () => {
    expect(routeByKeywords("Bonjour !").agent).toBeNull();
  });
});

describe("rollForward", () => {
  it("avance une échéance passée sans toucher une échéance future", () => {
    expect(rollForward("2026-08-05", "monthly", "2026-10-15")).toBe("2026-11-05");
    expect(rollForward("2026-10-20", "monthly", "2026-10-15")).toBe("2026-10-20");
    expect(rollForward("2026-10-15", "weekly", "2026-10-15")).toBe("2026-10-15");
    expect(rollForward(null, "yearly", "2026-10-15")).toBeNull();
  });
});

describe("groupAssignments", () => {
  it("fusionne les commerçants d'une même catégorie et d'une même origine", () => {
    const merchants = Array.from({ length: 150 }, (_, i) => ({
      categoryId: `c${i % 12}`,
      by: (i % 2 ? "rule" : "llm") as "rule" | "llm",
      ids: [`t${i}a`, `t${i}b`],
    }));
    const groups = groupAssignments(merchants);
    expect(groups.length).toBeLessThanOrEqual(24);
    // Résultat identique : chaque opération garde exactement sa catégorie et son origine.
    const flat = new Map(groups.flatMap((g) => g.ids.map((id) => [id, `${g.categoryId}|${g.by}`])));
    for (const m of merchants) for (const id of m.ids) expect(flat.get(id)).toBe(`${m.categoryId}|${m.by}`);
    expect(flat.size).toBe(300);
  });
});
