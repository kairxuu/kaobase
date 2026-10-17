import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  session: vi.fn(), setCookie: vi.fn(), revalidate: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
}));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.setCookie }) }));
import type { Supabase } from "@/lib/supabase/server";
import { completeSetup, getOnboardingStatus, getSetupInitial, parseSetupForm } from "@/lib/data/onboarding";
import { finishSetup } from "@/app/setup/actions";

const ACCOUNT = "10000000-0000-4000-8000-000000000001";
const fields = {
  displayName: "Camille", currency: "EUR", timezone: "Europe/Paris", accountId: ACCOUNT,
  accountName: "Compte courant", accountKind: "checking", openingBalance: "1250,50", space: "perso",
};
function form(overrides: Partial<typeof fields> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...fields, ...overrides })) data.set(key, value);
  return data;
}
function database(responses: Record<string, { data: unknown; error?: unknown }> = {}) {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const from = vi.fn((table: string) => {
    const response = responses[table] ?? (table === "profiles"
      ? { data: { display_name: "Camille", currency: "EUR", timezone: "Europe/Paris" } }
      : { data: null });
    const chain = {
      select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain),
      maybeSingle: vi.fn().mockResolvedValue(response), limit: vi.fn().mockResolvedValue(response),
    };
    return chain;
  });
  const getUser = vi.fn().mockResolvedValue({ data: { user: { user_metadata: {} } }, error: null });
  return { rpc, from, getUser, client: { rpc, from, auth: { getUser } } as unknown as Supabase };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validation des informations de configuration", () => {
  it("normalise les noms et accepte un solde négatif au centime", () => {
    expect(parseSetupForm(form({ displayName: " Camille ", accountName: " Perso ", openingBalance: "-12,50" })))
      .toMatchObject({ displayName: "Camille", accountName: "Perso", openingBalance: -12.5 });
  });
  it("accepte l'absence d'identifiant pour réutiliser ou créer le premier compte", () => {
    expect(parseSetupForm(form({ accountId: "" })).accountId).toBeNull();
  });
  it.each([
    { displayName: " " }, { displayName: "a".repeat(61) }, { currency: "XYZ" }, { timezone: "Mars/Olympus" },
    { accountId: "un-identifiant-invalide" }, { accountName: "" }, { accountKind: "inconnu" },
    { openingBalance: "1,234" }, { openingBalance: "1e3" }, { openingBalance: "Infinity" }, { space: "admin" },
  ])("rejette des informations invalides %j", (overrides) => {
    expect(() => parseSetupForm(form(overrides))).toThrow();
  });
});

describe("lecture de l'état et reprise de configuration", () => {
  it.each([
    [{ onboarding_completed_at: null }, "pending"],
    [{ onboarding_completed_at: "2026-10-17T12:00:00Z" }, "complete"],
  ] as const)("lit l'état %j sans changer de données", async (profile, expected) => {
    const db = database({ profiles: { data: profile } });
    expect(await getOnboardingStatus(db.client, "user")).toBe(expected);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { data: null }, { data: null, error: { code: "42703" } },
  ])("gère un profil ou une migration indisponible", async (response) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getOnboardingStatus(database({ profiles: response }).client, "user")).toBe("unavailable");
    log.mockRestore();
  });
  it("gère une panne réseau sans faire planter la page de configuration", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = database();
    db.from.mockImplementation(() => { throw new Error("Network unavailable"); });
    expect(await getOnboardingStatus(db.client, "user")).toBe("unavailable");
    log.mockRestore();
  });
  it("préremplit le compte existant et détecte son historique", async () => {
    const db = database({
      accounts: { data: [{ id: ACCOUNT, name: "Ancien compte", kind: "savings", opening_balance: "42.30", space: "pro" }] },
      transactions: { data: [{ id: "transaction" }] },
    });
    expect(await getSetupInitial(db.client, "user")).toMatchObject({
      displayName: "Camille", accountId: ACCOUNT, accountName: "Ancien compte", accountKind: "savings",
      openingBalance: "42.30", space: "pro", hasTransactions: true,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("prépare un premier compte sans en créer avant la validation", async () => {
    const db = database({ accounts: { data: [] } });
    expect(await getSetupInitial(db.client, "user")).toMatchObject({ accountId: null, accountName: "Compte courant", hasTransactions: false });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("n'affiche pas de préférences par défaut si leur lecture échoue", async () => {
    const db = database({ profiles: { data: null, error: { code: "NETWORK_ERROR" } }, accounts: { data: [] } });
    await expect(getSetupInitial(db.client, "user")).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
  it("n'écrase pas un fuseau manuel si la lecture d'authentification échoue", async () => {
    const db = database({ accounts: { data: [] } });
    db.getUser.mockResolvedValue({ data: { user: null }, error: new Error("Auth unavailable") });
    await expect(getSetupInitial(db.client, "user")).rejects.toThrow("Auth unavailable");
  });
});

describe("enregistrement initial authentifié", () => {
  it("réserve l'identité à la session et n'envoie aucun user_id depuis le formulaire", async () => {
    const db = database();
    await completeSetup(db.client, parseSetupForm(form()));
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("complete_onboarding", {
      p_display_name: "Camille", p_currency: "EUR", p_timezone: "Europe/Paris", p_account_id: ACCOUNT,
      p_account_name: "Compte courant", p_account_kind: "checking", p_opening_balance: 1250.5, p_space: "perso",
    });
  });
  it("n'annonce aucun succès si le RPC ne confirme pas l'enregistrement", async () => {
    const db = database();
    db.rpc.mockResolvedValue({ data: null, error: null });
    await expect(completeSetup(db.client, parseSetupForm(form()))).rejects.toThrow("n'a pas pu être enregistrée");
  });
  it("redirige après enregistrement et réinitialise un ancien filtre d'espace", async () => {
    const db = database();
    mocks.session.mockResolvedValue({ supabase: db.client, userId: "user" });
    await expect(finishSetup({}, form({ space: "pro" }))).rejects.toThrow("redirect:/");
    expect(mocks.setCookie).toHaveBeenCalledWith("kb_space", "all", expect.objectContaining({ httpOnly: true, path: "/" }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/");
  });
  it("garde le formulaire et évite redirection/cookie si l'enregistrement échoue", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = database();
    db.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "Ce compte contient déjà des opérations." } });
    mocks.session.mockResolvedValue({ supabase: db.client });
    expect(await finishSetup({}, form())).toEqual({ error: "Ce compte contient déjà des opérations." });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.setCookie).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("ne transforme pas la redirection de session expirée en erreur de formulaire", async () => {
    mocks.session.mockRejectedValue(new Error("redirect:/login"));
    await expect(finishSetup({}, form())).rejects.toThrow("redirect:/login");
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});
