import "server-only";
import { cache } from "react";
import type { DatabaseClient } from "@/lib/database/server";
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

// Profil complet : table profiles (prénom, devise) + métadonnées DatabaseClient Auth (nom, couleur, email).
// getUser() plutôt que le jeton : les métadonnées du jeton ne changent qu'au renouvellement de session.
export const getProfile = cache(async (db: DatabaseClient, userId: string): Promise<Profile> => {
  const [{ data: row }, { data: auth }] = await Promise.all([
    db.from("profiles").select("display_name, last_name, avatar_color, timezone_manual, currency, timezone, onboarding_completed_at, created_at").eq("id", userId).single(),
    db.rpc("current_identity").single(),
  ]);
  const meta = (row ?? {}) as Record<string, unknown>;
  const color = typeof meta.avatar_color === "string" && AVATAR_COLORS.includes(meta.avatar_color as never) ? meta.avatar_color : AVATAR_COLORS[0];
  return {
    firstName: (row?.display_name as string | null) ?? "",
    lastName: typeof meta.last_name === "string" ? meta.last_name : "",
    email: (auth as {email?: string} | null)?.email ?? "",
    pendingEmail: null,
    avatarColor: color,
    currency: (row?.currency as string | undefined) ?? "EUR",
    timezone: (row?.timezone as string | undefined) ?? "Europe/Paris",
    // Un fuseau validé dans le parcours initial ne doit plus être remplacé automatiquement.
    timezoneManual: meta.timezone_manual === true || Boolean(row?.onboarding_completed_at),
    memberSince: (row?.created_at as string | undefined) ?? (auth as {created_at?: string} | null)?.created_at ?? null,
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
export const getAiUsage = cache(async (db: DatabaseClient): Promise<AiUsage> => {
  const now = Date.now();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const minuteAgo = new Date(now - 60_000).toISOString();
  const [day, minute, runs] = await Promise.all([
    db.from("agent_request_reservations").select("id", { count: "exact", head: true }).gt("created_at", dayAgo),
    db.from("agent_request_reservations").select("id", { count: "exact", head: true }).gt("created_at", minuteAgo),
    db.from("agent_runs").select("input_tokens, output_tokens").gte("created_at", dayAgo).limit(2000),
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
