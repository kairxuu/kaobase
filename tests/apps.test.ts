import { describe, expect, it } from "vitest";
import { appHost, normalizeAppUrl, parseAppForm } from "@/lib/apps";

const valid = { name: "Gmail", url: "https://mail.google.com/", accountLabel: "moi@example.com", category: "communication", space: "perso", pinned: "on" };
function form(values: Record<string, string> = valid) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

describe("liens de raccourcis", () => {
  it.each([
    ["example.com", "https://example.com/"], [" https://EXAMPLE.com ", "https://example.com/"],
    ["https://example.com/login?account=perso#dashboard", "https://example.com/login?account=perso#dashboard"],
    ["http://intranet.example.test/", "http://intranet.example.test/"],
    ["https://example.com/@profil", "https://example.com/@profil"],
  ])("normalise %s", (input, expected) => expect(normalizeAppUrl(input)).toBe(expected));
  it.each([
    "", "javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "mailto:moi@example.com",
    "ftp://example.com", "https://user:password@example.com/", "https://user@example.com/",
    "https://user%40email:secret@example.com", "https://", "https://exa mple.com/", "https://example.com/a b",
    "https://example.com/\nscript", "https://example.com/\tapp", "https://example.com\\@other.com/", "https://example.com/" + "a".repeat(2048),
  ])("refuse une adresse active, ambiguë ou contenant des identifiants : %s", (input) => {
    expect(() => normalizeAppUrl(input)).toThrow();
  });
  it("affiche seulement le nom de domaine sans charger de favicon", () => {
    expect(appHost("https://www.example.com/path?account=me")).toBe("example.com");
    expect(appHost("invalid")).toBe("");
  });
});

describe("compte associé à une app", () => {
  it("normalise les libellés et ignore les champs propriétaire injectés", () => {
    expect(parseAppForm(form({ ...valid, name: " Gmail ", accountLabel: " moi@example.com ", user_id: "victim" }))).toEqual({
      name: "Gmail", url: valid.url, accountLabel: "moi@example.com", category: "communication", space: "perso", pinned: true,
    });
  });
  it("autorise un identifiant facultatif et prend l'espace actif par défaut", () => {
    expect(parseAppForm(form({ name: "Banque", url: "https://example.com" }), "pro")).toMatchObject({ accountLabel: "", space: "pro", category: "other", pinned: false });
  });
  it.each([
    { name: " " }, { name: "a".repeat(81) }, { name: "Mon\napp" }, { accountLabel: "moi\tpro" },
    { accountLabel: "a".repeat(161) }, { category: "admin" }, { space: "shared" }, { url: "javascript:alert(1)" },
  ])("refuse une saisie invalide %j", (override) => expect(() => parseAppForm(form({ ...valid, ...override }))).toThrow());
});
