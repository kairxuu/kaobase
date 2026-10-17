"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import { siteOrigin } from "@/lib/site";
import { getOnboardingStatus } from "@/lib/data/onboarding";

export type AuthState = { error?: string; info?: string };

export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Adresse pas encore confirmée : ouvre le lien reçu par email." };
    return { error: "Email ou mot de passe incorrect." };
  }
  const status = data.user ? await getOnboardingStatus(supabase, data.user.id) : "pending";
  redirect(status === "complete" ? "/" : "/setup");
}

export async function signUp(_: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Mot de passe : 8 caractères minimum." };
  const { data, error } = await supabase.auth.signUp({
    email: String(formData.get("email") ?? ""),
    password,
    options: {
      emailRedirectTo: `${await siteOrigin()}/auth/confirm`,
      data: { display_name: String(formData.get("name") ?? "") || undefined },
    },
  });
  if (error) return { error: friendlyError(error) };
  if (data.session) redirect("/setup");
  return { info: "Compte créé. Ouvre le lien de confirmation reçu par email, puis connecte-toi." };
}

// Mot de passe oublié : même réponse que le compte existe ou non (on ne révèle pas les adresses inscrites).
export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Indique ton adresse email." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=/auth/reset`,
  });
  if (error?.code === "over_email_send_rate_limit") return { error: friendlyError(error) };
  if (error) console.error("[kaobase] reset password :", error);
  return { info: "Si un compte existe avec cette adresse, un lien pour choisir un nouveau mot de passe vient d'être envoyé." };
}

// Nouveau mot de passe : depuis le lien reçu par email (session de récupération) ou depuis Réglages.
export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { error: "Mot de passe : 8 caractères minimum." };
  if (password !== confirm) return { error: "Les deux mots de passe ne correspondent pas." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: friendlyError(error) };
  if (formData.get("then") === "home") redirect("/");
  return { info: "Mot de passe modifié." };
}
