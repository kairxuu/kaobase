import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, previewCsv } from "@/lib/importers/csv";
import { normalizeMerchant } from "@/lib/finance/normalize";
import { detectSubscriptions } from "@/lib/learning/subscriptions";

// Chaîne complète hors base : relevé de démo -> parsing -> marchands -> détection d'abonnements.
describe("relevé de démo", () => {
  const csv = readFileSync(path.join(__dirname, "../demo/releve-demo.csv"), "utf8");

  it("est importable sans ligne invalide", () => {
    const preview = previewCsv(csv);
    expect(preview.mapping).not.toBeNull();
    const { rows, invalid } = parseCsv(csv, preview.mapping!);
    expect(invalid).toEqual([]);
    expect(rows.length).toBeGreaterThan(100);
  });

  it("détecte les abonnements mensuels et ignore les courses", () => {
    const { rows } = parseCsv(csv, previewCsv(csv).mapping!);
    const txs = rows.map((r) => ({ bookedAt: r.bookedAt, amount: r.amount, merchant: normalizeMerchant(r.labelRaw) }));
    const found = detectSubscriptions(txs, { today: "2026-10-15" });
    const merchants = found.map((s) => s.merchant);
    expect(merchants).toEqual(expect.arrayContaining(["NETFLIX", "SPOTIFY", "FREE MOBILE", "BASIC FIT", "FONCIA LOYER"]));
    expect(merchants.some((m) => m.startsWith("EDF"))).toBe(true);
    expect(merchants).not.toContain("CARREFOUR MARKET");
    expect(merchants).not.toContain("UBER EATS");
    expect(found.every((s) => s.period === "monthly")).toBe(true);
  });
});
