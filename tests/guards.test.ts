import { describe, expect, it } from "vitest";
import { isExplicitConfirmation } from "@/lib/agents/confirmation";
import { decideLimit, LIMITS } from "@/lib/agents/limits";
import { friendlyError, UserError } from "@/lib/errors";

describe("isExplicitConfirmation", () => {
  // Contrat D4 : le message de l'utilisateur lui-même doit contenir un accord ou une demande de suppression.
  it.each(["Oui", "oui, supprime-la", "Vas-y", "ok", "Je confirme", "Supprime l'opération Netflix", "c'est bon"])(
    "autorise « %s »",
    (m) => expect(isExplicitConfirmation(m)).toBe(true),
  );
  it.each(["non", "Non, ne supprime pas", "attends", "Quels abonnements je paie ?", "Montre mes dépenses du mois"])(
    "refuse « %s »",
    (m) => expect(isExplicitConfirmation(m)).toBe(false),
  );
});

describe("decideLimit", () => {
  const now = new Date("2026-10-15T12:00:30Z");
  it("laisse passer sous les seuils", () => {
    expect(decideLimit({ minute: LIMITS.perMinute - 1, day: 10, now })).toEqual({ allowed: true });
  });
  it("bloque à la 7e question de la minute avec le délai restant", () => {
    const d = decideLimit({ minute: LIMITS.perMinute, day: 10, oldestInMinute: "2026-10-15T12:00:00Z", now });
    expect(d).toMatchObject({ allowed: false, retryAfterSeconds: 30 });
  });
  it("bloque au-delà du quota quotidien", () => {
    expect(decideLimit({ minute: 0, day: LIMITS.perDay, now })).toMatchObject({ allowed: false });
  });
});

describe("friendlyError", () => {
  it("traduit les codes Postgres et Auth", () => {
    expect(friendlyError({ code: "23505", message: "duplicate key value" })).toBe("Cet élément existe déjà.");
    expect(friendlyError({ code: "invalid_credentials", message: "x" })).toBe("Email ou mot de passe incorrect.");
    expect(friendlyError(new Error('new row violates check constraint "x"'))).toBe("Une des valeurs saisies n'est pas acceptée.");
  });
  it("garde les messages écrits pour l'utilisateur", () => {
    expect(friendlyError(new UserError("Opération introuvable"))).toBe("Opération introuvable");
  });
  it("masque un message technique inconnu", () => {
    expect(friendlyError(new Error("TypeError: cannot read properties of undefined"))).toBe(
      "Une erreur inattendue est survenue. Réessaie dans un instant.",
    );
  });
});

describe("friendlyError — messages des actions", () => {
  it.each([
    "Nom : ce champ est obligatoire.",
    "La date est invalide.",
    "Montant invalide : saisis un nombre, par exemple 12,50.",
    "Garde au moins un compte : c'est là que vont les opérations.",
    "Catégorie introuvable",
    "Abonnement introuvable",
  ])("garde « %s »", (m) => expect(friendlyError(new UserError(m))).toBe(m));
});
