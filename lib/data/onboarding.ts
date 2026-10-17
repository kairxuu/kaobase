import "server-only";
import { z } from "zod";
import type { DatabaseClient } from "@/lib/database/server";
import { CURRENCIES, ACCOUNT_KINDS } from "@/lib/profile-options";
import { isValidTimezone } from "@/lib/time";
import { parseAmount } from "@/lib/importers/csv";
import { UserError } from "@/lib/errors";

export type OnboardingStatus = "pending" | "complete" | "unavailable";

export async function getOnboardingStatus(db: DatabaseClient, userId: string): Promise<OnboardingStatus> {
  try {
    const { data, error } = await db.from("profiles").select("onboarding_completed_at").eq("id", userId).maybeSingle();
    if (error || !data) throw error ?? new Error("Profil manquant");
    return data.onboarding_completed_at ? "complete" : "pending";
  } catch (error) {
    console.error("[kaobase] état de configuration indisponible :", error);
    return "unavailable";
  }
}

export type SetupInitial = {
  displayName: string;
  currency: string;
  timezone: string;
  timezoneManual: boolean;
  accountId: string | null;
  accountName: string;
  accountKind: (typeof ACCOUNT_KINDS)[number];
  openingBalance: string;
  space: "perso" | "pro";
  hasTransactions: boolean;
};

export async function getSetupInitial(db: DatabaseClient, userId: string): Promise<SetupInitial> {
  const [profileResult, accounts] = await Promise.all([
    db.from("profiles").select("display_name, currency, timezone, timezone_manual").eq("id", userId).maybeSingle(),
    db.from("accounts").select("id, name, kind, opening_balance, space").order("created_at").order("id").limit(1),
  ]);
  for (const result of [profileResult, accounts]) if (result.error) throw result.error;
  if (!profileResult.data) throw new UserError("Tes informations ne sont pas accessibles pour le moment.");
  const profile = profileResult.data;
  const account = accounts.data?.[0];
  let hasTransactions = false;
  if (account) {
    const transactions = await db.from("transactions").select("id").eq("account_id", account.id).limit(1);
    if (transactions.error) throw transactions.error;
    hasTransactions = Boolean(transactions.data?.length);
  }
  return {
    displayName: profile.display_name ?? "",
    currency: CURRENCIES.some(([code]) => code === profile.currency) ? profile.currency : "EUR",
    timezone: profile.timezone,
    timezoneManual: profile.timezone_manual === true,
    accountId: account?.id ?? null,
    accountName: account?.name ?? "Compte courant",
    accountKind: account && ACCOUNT_KINDS.includes(account.kind) ? account.kind : "checking",
    openingBalance: String(account?.opening_balance ?? "0"),
    space: account?.space === "pro" ? "pro" : "perso",
    hasTransactions,
  };
}

const schema = z.object({
  displayName: z.string().trim().min(1, "Indique ton prénom ou ton nom d'affichage.").max(60, "Le nom ne peut pas dépasser 60 caractères."),
  currency: z.enum(CURRENCIES.map(([code]) => code) as [string, ...string[]], { error: "Choisis une devise proposée." }),
  timezone: z.string().max(100).refine(isValidTimezone, "Choisis un fuseau horaire valide."),
  accountId: z.preprocess((v) => v === "" ? null : v, z.string().uuid().nullable()),
  accountName: z.string().trim().min(1, "Donne un nom à ton compte.").max(60, "Le nom du compte ne peut pas dépasser 60 caractères."),
  accountKind: z.enum(ACCOUNT_KINDS, { error: "Choisis un type de compte proposé." }),
  openingBalance: z.string().transform((raw, ctx) => {
    const amount = parseAmount(raw);
    if (amount == null) {
      ctx.addIssue({ code: "custom", message: "Saisis un solde valide avec deux décimales au maximum, par exemple 1250,50." });
      return z.NEVER;
    }
    return amount;
  }),
  space: z.enum(["perso", "pro"], { error: "Choisis l'espace personnel ou professionnel." }),
});

export function parseSetupForm(formData: FormData) {
  const result = schema.safeParse(Object.fromEntries(formData));
  if (!result.success) throw new UserError(result.error.issues[0]?.message ?? "Vérifie les informations saisies.");
  return result.data;
}

export async function completeSetup(db: DatabaseClient, input: ReturnType<typeof parseSetupForm>) {
  const { data, error } = await db.rpc("complete_onboarding", {
    p_display_name: input.displayName, p_currency: input.currency, p_timezone: input.timezone,
    p_account_id: input.accountId, p_account_name: input.accountName, p_account_kind: input.accountKind,
    p_opening_balance: input.openingBalance, p_space: input.space,
  });
  if (error?.code === "22023") throw new UserError(error.message);
  if (error) throw error;
  if (data !== true) throw new UserError("La configuration n'a pas pu être enregistrée. Réessaie.");
}
