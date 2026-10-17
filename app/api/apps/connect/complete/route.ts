import { revalidatePath } from "next/cache";
import { appApi, AppApiError, parseConnectionInput, readAppJson } from "@/lib/integrations/app-connect";
import { requireOAuthIntegration } from "@/lib/integrations/app-catalog";
import { getOwnedNangoConnection } from "@/lib/integrations/nango";
import { completeAppConnection } from "@/lib/data/app-connections";

export async function POST(request: Request) {
  return appApi(request, async ({ userId, supabase }) => {
    const input = parseConnectionInput(await readAppJson(request), true);
    const provider = await requireOAuthIntegration(input.providerId, input.integrationId);
    const connection = await getOwnedNangoConnection(userId, input.integrationId, input.connectionId!);
    if (connection.providerId && connection.providerId !== input.providerId) throw new AppApiError("Le service autorisé ne correspond pas à cette app.", 403);
    const shortcutId = await completeAppConnection(supabase, {
      ...input, providerName: provider.display_name, connectionId: connection.connectionId,
    });
    revalidatePath("/apps");
    revalidatePath("/");
    return { ok: true, shortcutId };
  });
}
