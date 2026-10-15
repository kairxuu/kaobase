import { z } from "zod";
import { getUserForApi } from "@/lib/auth";
import { askAgent } from "@/lib/agents/orchestrator";
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
    const { data: profile } = await session.supabase.from("profiles").select("currency").eq("id", session.userId).single();
    const reply = await askAgent(session.supabase, { ...parsed.data, currency: profile?.currency ?? "EUR" });
    return Response.json(reply);
  } catch (error) {
    console.error("[kaobase] /api/agents :", error);
    return Response.json({ error: error instanceof Error ? error.message : "Erreur interne" }, { status: 500 });
  }
}
