import type { Supabase } from "@/lib/supabase/server";

// Limite d'usage de l'IA par utilisateur : la clé Groq gratuite est partagée par tous les comptes.

export const LIMITS = { perMinute: 6, perDay: 150 } as const;

export type LimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number; message: string };

// `minute` et `day` : nombre de questions déjà posées dans la dernière minute et les dernières 24 h.
// `oldestInMinute` : date de la plus ancienne question de la dernière minute (pour le délai d'attente).
export function decideLimit(input: { minute: number; day: number; oldestInMinute?: string | null; now?: Date }): LimitDecision {
  const now = input.now ?? new Date();
  if (input.day >= LIMITS.perDay) {
    return {
      allowed: false,
      retryAfterSeconds: 3600,
      message: `Tu as atteint la limite de ${LIMITS.perDay} questions par jour. Réessaie demain.`,
    };
  }
  if (input.minute >= LIMITS.perMinute) {
    const oldest = input.oldestInMinute ? Date.parse(input.oldestInMinute) : now.getTime();
    const wait = Math.max(1, Math.ceil((oldest + 60_000 - now.getTime()) / 1000));
    return {
      allowed: false,
      retryAfterSeconds: wait,
      message: `Doucement : ${LIMITS.perMinute} questions par minute au maximum. Réessaie dans ${wait} s.`,
    };
  }
  return { allowed: true };
}


// Compte les questions de l'utilisateur (messages « user » dans agent_messages, sous RLS).
// En cas d'erreur de lecture, on laisse passer (fail open) : la limite protège le quota, pas la sécurité.
export async function checkUserLimit(supabase: Supabase): Promise<LimitDecision> {
  const now = new Date();
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  try {
    const [minute, day, oldest] = await Promise.all([
      supabase.from("agent_messages").select("id", { count: "exact", head: true }).eq("role", "user").gte("created_at", minuteAgo),
      supabase.from("agent_messages").select("id", { count: "exact", head: true }).eq("role", "user").gte("created_at", dayAgo),
      supabase
        .from("agent_messages")
        .select("created_at")
        .eq("role", "user")
        .gte("created_at", minuteAgo)
        .order("created_at", { ascending: true })
        .limit(1),
    ]);
    if (minute.error || day.error) throw minute.error ?? day.error;
    return decideLimit({
      minute: minute.count ?? 0,
      day: day.count ?? 0,
      oldestInMinute: (oldest.data?.[0]?.created_at as string | undefined) ?? null,
      now,
    });
  } catch (error) {
    console.warn("[kaobase] limite IA non vérifiée :", error);
    return { allowed: true };
  }
}
