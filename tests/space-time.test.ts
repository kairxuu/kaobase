import { describe, expect, it } from "vitest";
import { defaultSpace, parseSpaceFilter } from "@/lib/space-shared";
import { formatNowForPrompt, isValidTimezone, localDate } from "@/lib/time";

describe("parseSpaceFilter", () => {
  it.each([
    [undefined, "all"],
    ["", "all"],
    ["PRO", "all"],
    ["admin", "all"],
    ["perso", "perso"],
    ["pro", "pro"],
  ])("« %s » donne %s", (input, expected) => expect(parseSpaceFilter(input as string | undefined)).toBe(expected));

  it("crée en perso quand le filtre est « Tout »", () => {
    expect(defaultSpace("all")).toBe("perso");
    expect(defaultSpace("pro")).toBe("pro");
  });
});

describe("heure locale", () => {
  // 21 h 30 UTC le 15 octobre = 23 h 30 à Paris (UTC+2 en été).
  const lateEvening = new Date("2026-10-15T21:30:00Z");

  it("donne la date locale, pas la date UTC", () => {
    expect(localDate("Europe/Paris", new Date("2026-10-15T22:30:00Z"))).toBe("2026-10-16");
    expect(localDate("America/Montreal", new Date("2026-10-16T02:00:00Z"))).toBe("2026-10-15");
  });

  it("formate l'instant pour le prompt dans le fuseau de l'utilisateur", () => {
    expect(formatNowForPrompt("Europe/Paris", lateEvening)).toBe("jeudi 15 octobre 2026, 23 h 30 (Europe/Paris)");
  });

  it("gère l'heure d'hiver", () => {
    // 21 h 30 UTC le 15 décembre = 22 h 30 à Paris (UTC+1).
    expect(formatNowForPrompt("Europe/Paris", new Date("2026-12-15T21:30:00Z"))).toContain("22 h 30");
  });

  it("retombe sur Europe/Paris si le fuseau est invalide", () => {
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(formatNowForPrompt("Mars/Olympus", lateEvening)).toContain("(Europe/Paris)");
  });
});
