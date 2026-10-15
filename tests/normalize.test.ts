import { describe, expect, it } from "vitest";
import { dedupeHash, normalizeMerchant } from "@/lib/finance/normalize";

describe("normalizeMerchant", () => {
  it("unifie les variantes d'un même marchand", () => {
    expect(normalizeMerchant("PRLV SEPA NETFLIX.COM 12/03 REF 8841")).toBe("NETFLIX");
    expect(normalizeMerchant("CB NETFLIX.COM 14/04")).toBe("NETFLIX");
    expect(normalizeMerchant("PAYPAL *SPOTIFY")).toBe("SPOTIFY");
    expect(normalizeMerchant("PAYPAL *SPOTIFY P48213")).toBe("SPOTIFY");
  });

  it("retire accents, dates et numéros de carte", () => {
    expect(normalizeMerchant("CARTE X4521 CARREFOUR MARKET 03/02")).toBe("CARREFOUR MARKET");
    expect(normalizeMerchant("Électricité EDF")).toBe("ELECTRICITE EDF");
  });
});

describe("dedupeHash", () => {
  const base = { accountId: "a", bookedAt: "2026-01-01", amount: -9.99, labelRaw: "NETFLIX" };
  it("est stable et ignore la casse/espaces du libellé", () => {
    expect(dedupeHash(base)).toBe(dedupeHash({ ...base, labelRaw: "  netflix " }));
  });
  it("distingue deux paiements identiques le même jour via l'occurrence", () => {
    expect(dedupeHash(base)).not.toBe(dedupeHash({ ...base, occurrence: 1 }));
  });
});
