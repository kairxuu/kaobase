import "server-only";

import { z } from "zod";
import { UserError } from "@/lib/errors";

const NANGO_ORIGIN = "https://api.nango.dev";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const UNAVAILABLE_MESSAGE = "La connexion aux applications est temporairement indisponible. Réessaie dans un instant.";

const publicString = z.string().min(1).max(512);
const providerSchema = z.object({
  name: publicString,
  display_name: publicString,
  categories: z.array(publicString).max(100).default([]),
  auth_mode: publicString,
});
const integrationSchema = z.object({
  unique_key: publicString,
  provider: publicString,
  display_name: publicString.optional(),
});
const sessionSchema = z.object({
  data: z.object({
    token: z.string().min(1).max(8192),
    expires_at: z.iso.datetime({ offset: true }),
  }),
});

export type NangoProvider = z.infer<typeof providerSchema>;
export type NangoIntegration = z.infer<typeof integrationSchema>;
export type NangoSession = { token: string; expiresAt: string };
export type SanitizedNangoConnection = {
  connectionId: string;
  integrationId: string;
  providerId?: string;
  createdAt?: string;
};

/** Safe to expose through friendlyError; never attach an upstream body or cause. */
export class NangoUnavailableError extends UserError {
  constructor(public readonly status: 502 | 503 = 502) {
    super(UNAVAILABLE_MESSAGE);
  }
}

export class NangoConnectionNotFoundError extends UserError {
  readonly status = 404;

  constructor() {
    super("Cette connexion est introuvable. Connecte à nouveau ton compte.");
  }
}

export function isNangoConfigured(): boolean {
  return Boolean(process.env.NANGO_SECRET_KEY?.trim());
}

function assertIdentifier(value: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || value === "." || value === "..") {
    throw new UserError("La référence de cette application n'est pas valide.");
  }
}

function connectionPath(integrationId: string, connectionId: string): string {
  assertIdentifier(integrationId);
  assertIdentifier(connectionId);
  return `/connections/${encodeURIComponent(connectionId)}?${new URLSearchParams({ provider_config_key: integrationId })}`;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new NangoUnavailableError();
  }
  if (!response.body) throw new NangoUnavailableError();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new NangoUnavailableError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function nangoRequest(path: string, options: { method?: "GET" | "POST" | "DELETE"; body?: unknown; allowMissing?: boolean } = {}): Promise<unknown> {
  const secret = process.env.NANGO_SECRET_KEY?.trim();
  if (!secret) throw new NangoUnavailableError(503);

  try {
    const response = await fetch(`${NANGO_ORIGIN}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Error bodies can contain credentials. Discard them without reading or logging them.
      await response.body?.cancel().catch(() => {});
      if (response.status === 404 && options.allowMissing) throw new NangoConnectionNotFoundError();
      throw new NangoUnavailableError(response.status === 429 || response.status >= 500 ? 503 : 502);
    }
    if (response.status === 204 && options.method === "DELETE") return null;
    return await readBoundedJson(response);
  } catch (error) {
    if (error instanceof NangoUnavailableError || error instanceof NangoConnectionNotFoundError) throw error;
    // Fetch and JSON errors may contain the URL, body or credentials: retain none of them.
    throw new NangoUnavailableError();
  }
}

export async function getNangoProviders(): Promise<NangoProvider[]> {
  const parsed = z.object({ data: z.array(providerSchema) }).safeParse(await nangoRequest("/providers"));
  if (!parsed.success) throw new NangoUnavailableError();
  return parsed.data.data;
}

export async function getNangoIntegrations(): Promise<NangoIntegration[]> {
  const parsed = z.object({ data: z.array(integrationSchema) }).safeParse(await nangoRequest("/integrations"));
  if (!parsed.success) throw new NangoUnavailableError();
  return parsed.data.data;
}

export async function createNangoSession(userId: string, integrationId: string): Promise<NangoSession> {
  assertIdentifier(userId);
  assertIdentifier(integrationId);
  const parsed = sessionSchema.safeParse(await nangoRequest("/connect/sessions", {
    method: "POST",
    body: { tags: { end_user_id: userId }, allowed_integrations: [integrationId] },
  }));
  if (!parsed.success) throw new NangoUnavailableError();
  return { token: parsed.data.data.token, expiresAt: parsed.data.data.expires_at };
}

export async function getOwnedNangoConnection(userId: string, integrationId: string, connectionId: string): Promise<SanitizedNangoConnection> {
  assertIdentifier(userId);
  const raw = await nangoRequest(connectionPath(integrationId, connectionId), { allowMissing: true });
  const parsed = z.object({
    connection_id: publicString,
    provider_config_key: publicString,
    provider: publicString.optional(),
    created_at: z.iso.datetime({ offset: true }).optional(),
    tags: z.object({ end_user_id: publicString }),
    // This is the documented credential discriminator; auth_mode belongs to the provider catalog.
    credentials: z.object({ type: z.enum(["OAUTH1", "OAUTH2"]) }),
  }).safeParse(raw);
  if (!parsed.success) throw new NangoUnavailableError();
  const connection = parsed.data;
  if (connection.connection_id !== connectionId || connection.provider_config_key !== integrationId || connection.tags.end_user_id !== userId) {
    throw new NangoConnectionNotFoundError();
  }
  return {
    connectionId: connection.connection_id,
    integrationId: connection.provider_config_key,
    ...(connection.provider ? { providerId: connection.provider } : {}),
    ...(connection.created_at ? { createdAt: connection.created_at } : {}),
  };
}

async function requireOwnedConnectionMetadata(userId: string, integrationId: string, connectionId: string): Promise<void> {
  assertIdentifier(userId);
  assertIdentifier(integrationId);
  assertIdentifier(connectionId);
  const query = new URLSearchParams({ connectionId, "tags[end_user_id]": userId, limit: "1000" });
  // Listing metadata does not refresh credentials. A revoked OAuth token must
  // remain disconnectable even when the credentials endpoint would return 424.
  const raw = await nangoRequest(`/connections?${query}`, { allowMissing: true });
  const parsed = z.object({
    connections: z.array(z.object({
      connection_id: publicString,
      provider_config_key: publicString,
      tags: z.object({ end_user_id: publicString.optional() }).optional(),
    })).max(1000),
  }).safeParse(raw);
  if (!parsed.success) throw new NangoUnavailableError();
  // The API may return the same connection ID across integrations. Independently
  // enforce all three identifiers, including the server-selected user tag.
  if (!parsed.data.connections.some((connection) => connection.connection_id === connectionId
    && connection.provider_config_key === integrationId && connection.tags?.end_user_id === userId)) {
    throw new NangoConnectionNotFoundError();
  }
}

export async function deleteOwnedNangoConnection(userId: string, integrationId: string, connectionId: string): Promise<void> {
  try {
    await requireOwnedConnectionMetadata(userId, integrationId, connectionId);
  } catch (error) {
    if (error instanceof NangoConnectionNotFoundError) return;
    throw error;
  }
  try {
    const result = await nangoRequest(connectionPath(integrationId, connectionId), { method: "DELETE", allowMissing: true });
    if (result !== null && !z.object({ success: z.literal(true) }).safeParse(result).success) {
      throw new NangoUnavailableError();
    }
  } catch (error) {
    if (!(error instanceof NangoConnectionNotFoundError)) throw error;
  }
}
