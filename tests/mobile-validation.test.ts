import { describe, expect, it } from "vitest";
import * as v from "@/lib/mobile/validation";
describe("contrats de l'API iOS", () => {
  const valid = { accountId: null, bookedAt: "2026-10-17", amount: -12.34, label: "Courses", categoryId: null };
  it("accepte les centimes et refuse les fractions supplémentaires", () => {
    expect(v.transactionInput.safeParse(valid).success).toBe(true);
    for (const amount of [NaN, Infinity, 12.345, 1e12]) expect(v.transactionInput.safeParse({ ...valid, amount }).success).toBe(false);
  });
  it("interdit l'usurpation user_id et les clés non prévues", () => {
    expect(v.transactionInput.safeParse({ ...valid, user_id: "victim" }).success).toBe(false);
    expect(v.taskPatch.safeParse({ status: "done", user_id: "victim" }).success).toBe(false);
  });
  it("valide réellement les dates et la pagination mensuelle", () => {
    for (const value of ["2026-02-30", "2026-13-01", "tomorrow"]) expect(v.date.safeParse(value).success).toBe(false);
    for (const value of ["2026-00", "2026-13", "foo"]) expect(v.month.safeParse(value).success).toBe(false);
  });
  it("valide les préférences et garde les espaces fermés", () => {
    expect(v.profileInput.safeParse({ displayName: "Alex", currency: "EUR", timezone: "Europe/Paris" }).success).toBe(true);
    expect(v.profileInput.safeParse({ displayName: "Alex", currency: "XXX", timezone: "bad" }).success).toBe(false);
    expect(v.spaceFilter.safeParse("victim").success).toBe(false);
  });
});
