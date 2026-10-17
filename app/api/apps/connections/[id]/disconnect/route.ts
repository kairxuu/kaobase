import { revalidatePath } from "next/cache";
import { z } from "zod";
import { appApi, AppApiError } from "@/lib/integrations/app-connect";
import { getAppConnection, deleteAppConnection } from "@/lib/data/app-connections";
import { deleteOwnedNangoConnection } from "@/lib/integrations/nango";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return appApi(request, async ({ userId, supabase }) => {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) throw new AppApiError("Connexion introuvable.", 404);
    const connection = await getAppConnection(supabase, id);
    if (!connection) throw new AppApiError("Connexion introuvable.", 404);
    await deleteOwnedNangoConnection(userId, connection.integration_id, connection.connection_id);
    await deleteAppConnection(supabase, id);
    revalidatePath("/apps");
    revalidatePath("/");
    return { ok: true };
  });
}
