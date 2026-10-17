import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getOnboardingStatus: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
  auth: {
    getClaims: vi.fn(),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    verifyOtp: vi.fn(),
    exchangeCodeForSession: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/data/onboarding", () => ({ getOnboardingStatus: mocks.getOnboardingStatus }));
vi.mock("@/lib/site", () => ({ siteOrigin: async () => "https://kaobase.example" }));

import { getUserForApi, requireSession, requireUser } from "@/lib/auth";
import { signIn, signUp } from "@/app/login/actions";
import { GET } from "@/app/auth/confirm/route";

const user = { id: "user-id" };
const supabase = { auth: mocks.auth };

function credentials() {
  const form = new FormData();
  form.set("email", "test@example.com");
  form.set("password", "password123");
  form.set("name", "Camille");
  return form;
}

async function confirm(query: string) {
  return GET(new NextRequest(`https://kaobase.example/auth/confirm?${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue(supabase);
  mocks.getOnboardingStatus.mockResolvedValue("pending");
  mocks.auth.getClaims.mockResolvedValue({ data: { claims: { sub: user.id, email: "test@example.com" } }, error: null });
  mocks.auth.signInWithPassword.mockResolvedValue({ data: { user }, error: null });
  mocks.auth.signUp.mockResolvedValue({ data: { user, session: { access_token: "test" } }, error: null });
  mocks.auth.verifyOtp.mockResolvedValue({ data: { user }, error: null });
  mocks.auth.exchangeCodeForSession.mockResolvedValue({ data: { user }, error: null });
});

describe("accès avant et après la configuration initiale", () => {
  it("laisse le parcours de configuration vérifier la session sans boucle", async () => {
    await expect(requireSession()).resolves.toEqual({ supabase, userId: user.id, email: "test@example.com" });
    expect(mocks.getOnboardingStatus).not.toHaveBeenCalled();
  });

  it("renvoie un visiteur sans session à la connexion", async () => {
    mocks.auth.getClaims.mockResolvedValue({ data: null, error: null });
    await expect(requireSession()).rejects.toThrow("redirect:/login");
    expect(mocks.getOnboardingStatus).not.toHaveBeenCalled();
  });

  it.each(["pending", "unavailable"])("ouvre la configuration si son état est %s", async (status) => {
    mocks.getOnboardingStatus.mockResolvedValue(status);
    await expect(requireUser()).rejects.toThrow("redirect:/setup");
    expect(mocks.getOnboardingStatus).toHaveBeenCalledWith(supabase, user.id);
  });

  it("laisse accéder à l’application une fois la configuration terminée", async () => {
    mocks.getOnboardingStatus.mockResolvedValue("complete");
    await expect(requireUser()).resolves.toMatchObject({ userId: user.id });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("conserve le contrat des API sans redirection vers la configuration", async () => {
    await expect(getUserForApi()).resolves.toEqual({ supabase, userId: user.id });
    expect(mocks.getOnboardingStatus).not.toHaveBeenCalled();
    mocks.auth.getClaims.mockResolvedValue({ data: null, error: null });
    await expect(getUserForApi()).resolves.toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("inscription et connexion", () => {
  it("ouvre la configuration après une inscription avec session immédiate", async () => {
    await expect(signUp({}, credentials())).rejects.toThrow("redirect:/setup");
    expect(mocks.auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: { emailRedirectTo: "https://kaobase.example/auth/confirm", data: { display_name: "Camille" } },
    }));
  });

  it("attend la confirmation email lorsqu’aucune session n’a été créée", async () => {
    mocks.auth.signUp.mockResolvedValue({ data: { user, session: null }, error: null });
    await expect(signUp({}, credentials())).resolves.toEqual({ info: expect.stringContaining("confirmation") });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["pending", "unavailable"])("ouvre la configuration à la connexion si son état est %s", async (status) => {
    mocks.getOnboardingStatus.mockResolvedValue(status);
    await expect(signIn({}, credentials())).rejects.toThrow("redirect:/setup");
    expect(mocks.getOnboardingStatus).toHaveBeenCalledWith(supabase, user.id);
  });

  it("ouvre directement l’accueil aux connexions suivantes", async () => {
    mocks.getOnboardingStatus.mockResolvedValue("complete");
    await expect(signIn({}, credentials())).rejects.toThrow("redirect:/");
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/");
  });

  it("ne consulte pas le profil lorsque l’authentification échoue", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { code: "invalid_credentials" } });
    await expect(signIn({}, credentials())).resolves.toEqual({ error: "Email ou mot de passe incorrect." });
    expect(mocks.getOnboardingStatus).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("retour des liens email", () => {
  it.each(["pending", "unavailable"])("ouvre la configuration après confirmation quand l’état est %s", async (status) => {
    mocks.getOnboardingStatus.mockResolvedValue(status);
    const response = await confirm("token_hash=test-token&type=signup");
    expect(response.headers.get("location")).toBe("https://kaobase.example/setup");
    expect(mocks.auth.verifyOtp).toHaveBeenCalledWith({ type: "signup", token_hash: "test-token" });
  });

  it("retrouve l’accueil si la configuration est déjà terminée", async () => {
    mocks.getOnboardingStatus.mockResolvedValue("complete");
    const response = await confirm("token_hash=test-token&type=email");
    expect(response.headers.get("location")).toBe("https://kaobase.example/");
  });

  it("gère aussi la confirmation PKCE avant la première configuration", async () => {
    const response = await confirm("code=test-code");
    expect(response.headers.get("location")).toBe("https://kaobase.example/setup");
    expect(mocks.auth.exchangeCodeForSession).toHaveBeenCalledWith("test-code");
  });

  it("préserve le parcours de récupération du mot de passe", async () => {
    const response = await confirm("token_hash=test-token&type=recovery");
    expect(response.headers.get("location")).toBe("https://kaobase.example/auth/reset");
    expect(mocks.getOnboardingStatus).not.toHaveBeenCalled();
  });

  it.each(["/settings", "/auth/reset"])("préserve la destination interne %s", async (next) => {
    const response = await confirm(`code=test-code&next=${encodeURIComponent(next)}`);
    expect(response.headers.get("location")).toBe(`https://kaobase.example${next}`);
    expect(mocks.getOnboardingStatus).not.toHaveBeenCalled();
  });

  it.each(["https://other.example/path", "//other.example", "/\\other.example", "/%2Fother.example"])(
    "refuse la destination externe ou ambiguë %s", async (next) => {
      const response = await confirm(`code=test-code&next=${encodeURIComponent(next)}`);
      expect(response.headers.get("location")).toBe("https://kaobase.example/setup");
    },
  );

  it("renvoie à la connexion lorsque le lien est expiré", async () => {
    mocks.auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { code: "otp_expired" } });
    const response = await confirm("token_hash=expired&type=signup");
    expect(response.headers.get("location")).toBe("https://kaobase.example/login?lien=expire");
    expect(mocks.getOnboardingStatus).not.toHaveBeenCalled();
  });
});
