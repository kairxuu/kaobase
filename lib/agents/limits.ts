import type { DatabaseClient } from "@/lib/database/server";
import { z } from "zod";

// Limite d'usage de l'IA par utilisateur : la clé Groq gratuite est partagée par tous les comptes.

export const LIMITS = { perMinute: 6, perDay: 150 } as const;

export type LimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number; message: string };

export class LimitUnavailableError extends Error {
  constructor() {
    super("L'IA est momentanément indisponible. Réessaie dans quelques instants.");
    this.name = "LimitUnavailableError";
  }
}

const reservationSchema = z.object({
  allowed: z.boolean(),
  retry_after_seconds: z.number().int().min(0).max(86_400),
  limit_reason: z.enum(["minute", "day"]).nullable(),
  minute_count: z.number().int().nonnegative(),
  day_count: z.number().int().nonnegative(),
}).refine((row) => row.day_count >= row.minute_count).refine((row) => row.allowed
  ? row.retry_after_seconds === 0 && row.limit_reason === null && row.minute_count >= 1 && row.minute_count <= LIMITS.perMinute && row.day_count <= LIMITS.perDay
  : row.retry_after_seconds > 0 && (row.limit_reason === "minute"
    ? row.minute_count >= LIMITS.perMinute : row.limit_reason === "day" && row.day_count >= LIMITS.perDay));

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


// Réservation atomique et non modifiable depuis le client, avant toute exécution.
// Une panne ou une réponse RPC inattendue interrompt l'appel IA.
export async function checkUserLimit(db: DatabaseClient): Promise<LimitDecision> {
  try {
    const { data, error } = await db.rpc("reserve_agent_request");
    if (error) throw error;
    const [reservation] = z.array(reservationSchema).length(1).parse(data);
    if (reservation.allowed) return { allowed: true };
    const wait = reservation.retry_after_seconds;
    return {
      allowed: false,
      retryAfterSeconds: wait,
      message: reservation.limit_reason === "day"
        ? `Tu as atteint la limite de ${LIMITS.perDay} questions sur 24 h. Réessaie dans ${Math.ceil(wait / 60)} min.`
        : `Doucement : ${LIMITS.perMinute} questions par minute au maximum. Réessaie dans ${wait} s.`,
    };
  } catch (error) {
    console.error("[kaobase] réservation quota IA indisponible :", error);
    throw new LimitUnavailableError();
  }
}
