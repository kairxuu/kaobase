import { appApi } from "@/lib/integrations/app-connect";
import { getAppCatalog } from "@/lib/integrations/app-catalog";

export async function GET() {
  return appApi(null, async () => getAppCatalog());
}
