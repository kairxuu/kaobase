import { z } from "zod";
import { getUserForApi } from "@/lib/auth";
import { applyFeedback } from "@/lib/learning/memory";

const bodySchema = z.object({
  runId: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]),
  correction: z.string().trim().max(4000).nullable().default(null),
});

export async function POST(request: Request) {
  const session = await getUserForApi();
  if (!session) return Response.json({ error: "Non authentifié" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Requête invalide" }, { status: 400 });

  try {
    await applyFeedback(session.supabase, parsed.data.runId, parsed.data.rating, parsed.data.correction || null);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erreur" }, { status: 400 });
  }
}
