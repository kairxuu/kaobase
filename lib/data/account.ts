import "server-only";
import { cache } from "react";
import type { Supabase } from "@/lib/supabase/server";
import { LIMITS } from "@/lib/agents/limits";

// Couleurs d'avatar proposées dans Réglages (tons de la charte, lisibles en clair et en sombre).
export const AVATAR_COLORS = ["#4433e0", "#1d7348", "#b0284e", "#8a5a00", "#0e7490", "#7c3aed", "#475569"] as const;

export type Profile = {
  firstName: string;
  lastName: string;
  email: string;
  pendingEmail: string | null;
  avatarColor: string;
  currency: string;
  timezone: string;
  timezoneManual: boolean;
  memberSince: string | null;
};

// Profil complet : table profiles (prénom, devise) + métadonnées Supabase Auth (nom, couleur, email).
// getUser() plutôt que le jeton : les métadonnées du jeton ne changent qu'au renouvellement de session.
export const getProfile = cache(async (supabase: Supabase, userId: string): Promise<Profile> => {
  const [{ data: row }, { data: auth }] = await Promise.all([
    supabase.from("profiles").select("display_name, currency, timezone, created_at").eq("id", userId).single(),
    supabase.auth.getUser(),
  ]);
  const meta = (auth.user?.user_metadata ?? {}) as Record<string, unknown>;
  const color = typeof meta.avatar_color === "string" && AVATAR_COLORS.includes(meta.avatar_color as never) ? meta.avatar_color : AVATAR_COLORS[0];
  return {
    firstName: (row?.display_name as string | null) ?? "",
    lastName: typeof meta.last_name === "string" ? meta.last_name : "",
    email: auth.user?.email ?? "",
    pendingEmail: auth.user?.new_email ?? null,
    avatarColor: color,
    currency: (row?.currency as string | undefined) ?? "EUR",
    timezone: (row?.timezone as string | undefined) ?? "Europe/Paris",
    timezoneManual: meta.timezone_manual === true,
    memberSince: (row?.created_at as string | undefined) ?? auth.user?.created_at ?? null,
  };
});

export type AiUsage = {
  questionsToday: number;
  questionsLimit: number;
  questionsThisMinute: number;
  minuteLimit: number;
  tokensToday: number;
};

// Usage de l'IA sur les dernières 24 h : même fenêtre que la limite appliquée par /api/agents.
export const getAiUsage = cache(async (supabase: Supabase): Promise<AiUsage> => {
  const now = Date.now();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const minuteAgo = new Date(now - 60_000).toISOString();
  const [day, minute, runs] = await Promise.all([
    supabase.from("agent_request_reservations").select("id", { count: "exact", head: true }).gt("created_at", dayAgo),
    supabase.from("agent_request_reservations").select("id", { count: "exact", head: true }).gt("created_at", minuteAgo),
    supabase.from("agent_runs").select("input_tokens, output_tokens").gte("created_at", dayAgo).limit(2000),
  ]);
  const tokensToday = (runs.data ?? []).reduce(
    (sum, r) => sum + Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0),
    0,
  );
  return {
    questionsToday: day.count ?? 0,
    questionsLimit: LIMITS.perDay,
    questionsThisMinute: minute.count ?? 0,
    minuteLimit: LIMITS.perMinute,
    tokensToday,
  };
});

export function initials(profile: Pick<Profile, "firstName" | "lastName" | "email">) {
  const fromName = `${profile.firstName.trim()[0] ?? ""}${profile.lastName.trim()[0] ?? ""}`;
  return (fromName || profile.email[0] || "?").toUpperCase();
}
