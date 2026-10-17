import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getUserForApi } from "@/lib/auth";
import { friendlyError, UserError } from "@/lib/errors";

const schema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().uuid(),
  decision: z.enum(["confirm", "cancel"]),
});

// Cette route est appelée par les boutons du chat ; aucun outil IA ne peut l'exécuter.
export async function POST(request: Request) {
  const session = await getUserForApi();
  if (!session) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Origine refusée" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Requête invalide" }, { status: 400 });
  const { requestId, conversationId, decision } = parsed.data;
  try {
    let message: string;
    if (decision === "confirm") {
      const { data, error } = await session.db.rpc("confirm_agent_deletion", {
        p_request_id: requestId, p_conversation_id: conversationId,
      });
      if (error?.code === "P0002") throw new UserError(error.message);
      if (error) throw error;
      if (!data?.[0]) throw new UserError("Confirmation introuvable.");
      message = `Suppression confirmée : ${data[0].description}`;
    } else {
      const { data, error } = await session.db.from("agent_deletion_requests").delete()
        .eq("id", requestId).eq("conversation_id", conversationId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new UserError("Confirmation introuvable.");
      message = "Suppression annulée.";
    }
    for (const path of ["/", "/transactions", "/tasks", "/settings", "/agents"]) revalidatePath(path);
    return Response.json({ message });
  } catch (error) {
    console.error("[kaobase] confirmation de suppression :", error);
    return Response.json({ error: friendlyError(error) }, { status: 400 });
  }
}
