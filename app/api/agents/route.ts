import { z } from "zod";
import { getUserForApi } from "@/lib/auth";
import { askAgent } from "@/lib/agents/orchestrator";
import { checkUserLimit, LimitUnavailableError } from "@/lib/agents/limits";
import { friendlyError } from "@/lib/errors";
import { getSpaceFilter } from "@/lib/space";
import { AGENT_IDS } from "@/lib/learning/router";

export const maxDuration = 60;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  agent: z.enum(["auto", ...AGENT_IDS]).default("auto"),
  conversationId: z.string().uuid(),
});

export async function POST(request: Request) {
  const session = await getUserForApi();
  if (!session) return Response.json({ error: "Non authentifié" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Requête invalide" }, { status: 400 });

  try {
    const limit = await checkUserLimit(session.supabase);
    if (!limit.allowed) {
      return Response.json(
        { error: limit.message, retryAfter: limit.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
    const { data: profile } = await session.supabase.from("profiles").select("currency, timezone").eq("id", session.userId).single();
    const reply = await askAgent(session.supabase, {
      ...parsed.data,
      currency: profile?.currency ?? "EUR",
      timezone: profile?.timezone ?? "Europe/Paris",
      space: await getSpaceFilter(),
    });
    return Response.json(reply);
  } catch (error) {
    if (error instanceof LimitUnavailableError) {
      return Response.json({ error: error.message }, { status: 503, headers: { "Retry-After": "10" } });
    }
    console.error("[kaobase] /api/agents :", error);
    return Response.json({ error: friendlyError(error) }, { status: 500 });
  }
}
