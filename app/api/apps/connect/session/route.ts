import { appApi, AppApiError, parseConnectionInput, readAppJson } from "@/lib/integrations/app-connect";
import { requireOAuthIntegration } from "@/lib/integrations/app-catalog";
import { createNangoSession } from "@/lib/integrations/nango";
import { reserveAppConnectSession } from "@/lib/data/app-connections";

export async function POST(request: Request) {
  return appApi(request, async ({ userId, db }) => {
    const input = parseConnectionInput(await readAppJson(request));
    // The database quota also verifies that the migration is installed before OAuth starts.
    const reservation = await reserveAppConnectSession(db);
    if (!reservation.allowed) throw new AppApiError(`Trop de tentatives de connexion. Réessaie dans ${Math.max(1, Math.ceil(reservation.retryAfterSeconds / 60))} minute(s).`, 429);
    await requireOAuthIntegration(input.providerId, input.integrationId);
    return createNangoSession(userId, input.integrationId);
  });
}
