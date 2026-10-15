"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; info?: string };

export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Adresse pas encore confirmée : ouvre le lien reçu par email." };
    return { error: "Email ou mot de passe incorrect." };
  }
  redirect("/");
}

export async function signUp(_: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const origin = (await headers()).get("origin") ?? "";
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Mot de passe : 8 caractères minimum." };
  const { data, error } = await supabase.auth.signUp({
    email: String(formData.get("email") ?? ""),
    password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm`,
      data: { display_name: String(formData.get("name") ?? "") || undefined },
    },
  });
  if (error) return { error: error.message };
  if (data.session) redirect("/");
  return { info: "Compte créé. Ouvre le lien de confirmation reçu par email, puis connecte-toi." };
}
