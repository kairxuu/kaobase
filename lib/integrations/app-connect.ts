import "server-only";
import { z } from "zod";
import { getUserForApi } from "@/lib/auth";
import { getOnboardingStatus } from "@/lib/data/onboarding";
import { parseAppForm } from "@/lib/apps";
import { UserError, friendlyError } from "@/lib/errors";

export class AppApiError extends UserError {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export const connectionIdentifier = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value) && value !== "." && value !== "..");

const inputSchema = z.object({
  providerId: connectionIdentifier(128), integrationId: connectionIdentifier(255),
  name: z.string().max(80), url: z.string().max(2048), accountLabel: z.string().max(160).default(""),
  category: z.string().max(32), space: z.enum(["perso", "pro"]), pinned: z.boolean(),
  connectionId: connectionIdentifier(255).optional(),
});

export function parseConnectionInput(input: unknown, complete = false) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success || (complete && !parsed.data.connectionId)) throw new AppApiError("Vérifie les informations de l'app.");
  const value = parsed.data;
  const form = new FormData();
  for (const field of ["name", "url", "accountLabel", "category", "space"] as const) form.set(field, value[field]);
  if (value.pinned) form.set("pinned", "on");
  return { ...parseAppForm(form), providerId: value.providerId, integrationId: value.integrationId, connectionId: value.connectionId };
}

export async function readAppJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new AppApiError("Le format de la demande est invalide.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppApiError("La demande est vide.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new AppApiError("La demande est trop volumineuse.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new AppApiError("La demande est invalide."); }
  } finally { reader.releaseLock(); }
}

export function checkAppOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppApiError("Cette demande doit venir de Kaobase.", 403);
  }
}

type ApiSession = NonNullable<Awaited<ReturnType<typeof getUserForApi>>>;
export async function appApi(request: Request | null, action: (session: ApiSession) => Promise<unknown>) {
  try {
    if (request) checkAppOrigin(request);
    const session = await getUserForApi();
    if (!session) throw new AppApiError("Reconnecte-toi pour gérer tes apps.", 401);
    if (await getOnboardingStatus(session.supabase, session.userId) !== "complete") throw new AppApiError("Termine la configuration de ton compte avant de connecter une app.", 403);
    return Response.json(await action(session), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const candidate = error as { status?: unknown; code?: unknown } | null;
    const status = error instanceof UserError ? (typeof candidate?.status === "number" ? candidate.status : 400)
      : candidate?.code === "PGRST205" || candidate?.code === "42P01" ? 503 : 500;
    // Do not log upstream responses: connection responses can contain OAuth credentials.
    return Response.json({ error: friendlyError(error) }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
