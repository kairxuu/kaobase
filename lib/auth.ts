import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOnboardingStatus } from "@/lib/data/onboarding";

// La configuration initiale doit rester accessible avant que le profil soit complété.
export const requireSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  return { supabase, userId, email: (data.claims.email as string | undefined) ?? "" };
});

// Couche d'accès aux écrans et actions de l'application, après la configuration initiale.
export const requireUser = cache(async () => {
  const session = await requireSession();
  if (await getOnboardingStatus(session.supabase, session.userId) !== "complete") redirect("/setup");
  return session;
});

// Variante pour les routes API : pas de redirection, renvoie null.
export async function getUserForApi() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return userId ? { supabase, userId } : null;
}

// Devise d'affichage choisie dans Réglages (une lecture par requête).
export const getCurrency = cache(async () => {
  const { supabase, userId } = await requireUser();
  const { data } = await supabase.from("profiles").select("currency").eq("id", userId).single();
  return (data?.currency as string | undefined) ?? "EUR";
});
