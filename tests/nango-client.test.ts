import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createNangoSession,
  deleteOwnedNangoConnection,
  getNangoIntegrations,
  getNangoProviders,
  getOwnedNangoConnection,
  isNangoConfigured,
  NangoConnectionNotFoundError,
  NangoUnavailableError,
} from "@/lib/integrations/nango";
import { UserError } from "@/lib/errors";

const fetchMock = vi.fn<typeof fetch>();
const USER = "user-a";
const INTEGRATION = "github-personal";
const CONNECTION = "connection-a";
const SECRET_MARKER = "server-secret-must-never-be-serialized";
const TOKEN_MARKER = "oauth-credential-must-never-be-serialized";

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function connection(overrides: Record<string, unknown> = {}) {
  return {
    connection_id: CONNECTION,
    provider_config_key: INTEGRATION,
    provider: "github",
    created_at: "2026-10-17T10:00:00.000Z",
    tags: { end_user_id: USER, private_tag: TOKEN_MARKER },
    credentials: { type: "OAUTH2", access_token: TOKEN_MARKER, refresh_token: TOKEN_MARKER, raw: { token: TOKEN_MARKER } },
    metadata: { private: TOKEN_MARKER },
    connection_config: { api_key: TOKEN_MARKER },
    end_user: { id: "untrusted-deprecated-user" },
    ...overrides,
  };
}
function connectionMetadata(overrides: Record<string, unknown> = {}) {
  return { connection_id: CONNECTION, provider_config_key: INTEGRATION, tags: { end_user_id: USER }, errors: [], ...overrides };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NANGO_SECRET_KEY", SECRET_MARKER);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Nango server client catalog and sessions", () => {
  it("fails safely without a configured server key and never fetches", async () => {
    vi.stubEnv("NANGO_SECRET_KEY", "  ");
    expect(isNangoConfigured()).toBe(false);
    await expect(getNangoProviders()).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only returns catalog display fields and authenticates at the fixed origin", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [{ name: "github", display_name: "GitHub", categories: ["dev-tools"], auth_mode: "OAUTH2", authorization_url: TOKEN_MARKER, proxy: { base_url: TOKEN_MARKER } }], secret: TOKEN_MARKER }));
    expect(isNangoConfigured()).toBe(true);
    expect(await getNangoProviders()).toEqual([{ name: "github", display_name: "GitHub", categories: ["dev-tools"], auth_mode: "OAUTH2" }]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://api.nango.dev/providers", expect.objectContaining({
      cache: "no-store", redirect: "error", signal: expect.any(AbortSignal),
      headers: { Authorization: `Bearer ${SECRET_MARKER}`, Accept: "application/json" },
    }));
  });

  it("only returns integration identity fields without OAuth client credentials", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [{ unique_key: INTEGRATION, provider: "github", display_name: "GitHub", credentials: { client_secret: TOKEN_MARKER } }] }));
    const result = await getNangoIntegrations();
    expect(result).toEqual([{ unique_key: INTEGRATION, provider: "github", display_name: "GitHub" }]);
    expect(JSON.stringify(result)).not.toContain(TOKEN_MARKER);
  });

  it("binds a connect session to one integration and the server-selected end user", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { token: "session-token", expires_at: "2026-10-17T10:30:00.000Z", connect_link: "https://connect.nango.dev/?session_token=session-token", credentials: TOKEN_MARKER } }, 201));
    expect(await createNangoSession(USER, INTEGRATION)).toEqual({ token: "session-token", expiresAt: "2026-10-17T10:30:00.000Z" });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.nango.dev/connect/sessions");
    expect(options?.method).toBe("POST");
    expect(JSON.parse(options?.body as string)).toEqual({ tags: { end_user_id: USER }, allowed_integrations: [INTEGRATION] });
    expect(options?.cache).toBe("no-store");
  });

  it.each([{}, { data: {} }, { data: [{ name: "github", display_name: "GitHub", categories: [], auth_mode: 1 }] }])("rejects a malformed catalog %#", async (data) => {
    fetchMock.mockResolvedValueOnce(json(data));
    await expect(getNangoProviders()).rejects.toBeInstanceOf(NangoUnavailableError);
  });

  it.each([{ data: { token: "session-token", expires_at: "invalid" } }, { token: "not-an-envelope", expires_at: "2026-10-17T10:30:00.000Z" }])("rejects a malformed session %#", async (data) => {
    fetchMock.mockResolvedValueOnce(json(data));
    await expect(createNangoSession(USER, INTEGRATION)).rejects.toBeInstanceOf(NangoUnavailableError);
  });
});

describe("owned Nango connections", () => {
  it.each(["OAUTH1", "OAUTH2"])("accepts a verified %s connection but strips credentials and metadata", async (type) => {
    fetchMock.mockResolvedValueOnce(json(connection({ credentials: { type, raw: { token: TOKEN_MARKER } } })));
    const result = await getOwnedNangoConnection(USER, INTEGRATION, CONNECTION);
    expect(result).toEqual({ connectionId: CONNECTION, integrationId: INTEGRATION, providerId: "github", createdAt: "2026-10-17T10:00:00.000Z" });
    expect(JSON.stringify(result)).not.toContain(TOKEN_MARKER);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.nango.dev/connections/${CONNECTION}?provider_config_key=${INTEGRATION}`);
  });

  it.each([
    { connection_id: "other-connection" },
    { provider_config_key: "other-integration" },
    { tags: { end_user_id: "other-user" }, end_user: { id: USER } },
  ])("fails closed on mismatched ownership %#", async (overrides) => {
    fetchMock.mockResolvedValueOnce(json(connection(overrides)));
    await expect(getOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).rejects.toBeInstanceOf(NangoConnectionNotFoundError);
  });

  it.each(["API_KEY", "OAUTH2_CC", "BASIC", "NONE"])("rejects %s credentials", async (type) => {
    fetchMock.mockResolvedValueOnce(json(connection({ credentials: { type, token: TOKEN_MARKER } })));
    await expect(getOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).rejects.toBeInstanceOf(NangoUnavailableError);
  });

  it("rejects a response without current tags even if the deprecated end_user matches", async () => {
    fetchMock.mockResolvedValueOnce(json(connection({ tags: {}, end_user: { id: USER } })));
    await expect(getOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).rejects.toBeInstanceOf(NangoUnavailableError);
  });

  it("encodes caller identifiers without changing the API origin or query", async () => {
    const connectionId = "connection/https://evil.test?other=1";
    const integrationId = "integration&other=1";
    fetchMock.mockResolvedValueOnce(json(connection({ connection_id: connectionId, provider_config_key: integrationId })));
    await getOwnedNangoConnection(USER, integrationId, connectionId);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.nango.dev/connections/${encodeURIComponent(connectionId)}?provider_config_key=integration%26other%3D1`);
  });

  it.each(["", "..", ".", "bad\nvalue", "x".repeat(513)])("rejects unsafe identifiers before fetching %#", async (id) => {
    await expect(getOwnedNangoConnection(USER, INTEGRATION, id)).rejects.toBeInstanceOf(UserError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies ownership before deleting the exact connection", async () => {
    fetchMock.mockResolvedValueOnce(json({ connections: [connectionMetadata()] })).mockResolvedValueOnce(json({ success: true }));
    await deleteOwnedNangoConnection(USER, INTEGRATION, CONNECTION);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.nango.dev/connections?connectionId=${CONNECTION}&tags%5Bend_user_id%5D=${USER}&limit=1000`);
    expect(fetchMock.mock.calls[1]).toEqual([`https://api.nango.dev/connections/${CONNECTION}?provider_config_key=${INTEGRATION}`, expect.objectContaining({ method: "DELETE" })]);
  });

  it("disconnects a revoked OAuth connection using metadata without fetching credentials", async () => {
    fetchMock.mockImplementation(async (url, options) => {
      const endpoint = new URL(String(url));
      if (options?.method === "DELETE") return json({ success: true });
      // A credentials refresh would fail for this connection. Only the metadata
      // endpoint remains usable after authorization has been revoked upstream.
      if (endpoint.pathname !== "/connections") return json({ error: "invalid_credentials" }, 424);
      return json({ connections: [connectionMetadata({ errors: [{ type: "auth", log_id: "revoked-oauth" }] })] });
    });
    await expect(deleteOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const reads = fetchMock.mock.calls.filter(([, options]) => options?.method === "GET");
    expect(reads.map(([url]) => new URL(String(url)).pathname)).toEqual(["/connections"]);
  });

  it.each([
    { tags: { end_user_id: "other-user" } }, { provider_config_key: "other-integration" },
    { connection_id: "other-connection" }, { tags: {} },
  ])("never sends DELETE for mismatched connection metadata %#", async (overrides) => {
    fetchMock.mockResolvedValueOnce(json({ connections: [connectionMetadata(overrides)] }));
    await deleteOwnedNangoConnection(USER, INTEGRATION, CONNECTION);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it("does not delete a same-ID connection from another integration", async () => {
    fetchMock.mockResolvedValueOnce(json({ connections: [
      connectionMetadata({ provider_config_key: "other-integration" }),
      connectionMetadata(),
    ] })).mockResolvedValueOnce(json({ success: true }));
    await deleteOwnedNangoConnection(USER, INTEGRATION, CONNECTION);
    expect(fetchMock.mock.calls[1][0]).toBe(`https://api.nango.dev/connections/${CONNECTION}?provider_config_key=${INTEGRATION}`);
  });

  it("treats an empty metadata list as already absent without deleting", async () => {
    fetchMock.mockResolvedValueOnce(json({ connections: [] }));
    await expect(deleteOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed metadata instead of treating an upstream failure as absent", async () => {
    fetchMock.mockResolvedValueOnce(json({ connections: null }));
    await expect(deleteOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).rejects.toBeInstanceOf(NangoUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("encodes metadata query parameters without accepting additional caller filters", async () => {
    const userId = "user&tags[other]=victim";
    const connectionId = "connection&limit=1";
    fetchMock.mockResolvedValueOnce(json({ connections: [connectionMetadata({ connection_id: connectionId, tags: { end_user_id: userId } })] }))
      .mockResolvedValueOnce(json({ success: true }));
    await deleteOwnedNangoConnection(userId, INTEGRATION, connectionId);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect([...url.searchParams]).toEqual([["connectionId", connectionId], ["tags[end_user_id]", userId], ["limit", "1000"]]);
  });

  it("does not announce deletion if Nango does not acknowledge success", async () => {
    fetchMock.mockResolvedValueOnce(json({ connections: [connectionMetadata()] })).mockResolvedValueOnce(json({ success: false }));
    await expect(deleteOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).rejects.toBeInstanceOf(NangoUnavailableError);
  });

  it("accepts a successful empty deletion response", async () => {
    fetchMock.mockResolvedValueOnce(json({ connections: [connectionMetadata()] })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).resolves.toBeUndefined();
  });

  it("preserves a remote deletion error after successful metadata verification", async () => {
    fetchMock.mockResolvedValueOnce(json({ connections: [connectionMetadata()] })).mockResolvedValueOnce(json({ error: TOKEN_MARKER }, 503));
    await expect(deleteOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["get", "delete"])("treats an upstream 404 on %s as already absent for deletion", async (step) => {
    if (step === "delete") fetchMock.mockResolvedValueOnce(json({ connections: [connectionMetadata()] }));
    fetchMock.mockResolvedValueOnce(json({ error: TOKEN_MARKER }, 404));
    await expect(deleteOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(step === "get" ? 1 : 2);
  });

  it("exposes a safe not-found error for a missing connection", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: TOKEN_MARKER }, 404));
    await expect(getOwnedNangoConnection(USER, INTEGRATION, CONNECTION)).rejects.toMatchObject({ status: 404 });
  });
});

describe("bounded and safe Nango responses", () => {
  it.each([401, 403, 429, 500])("discards upstream %s errors without reading or logging tokens", async (status) => {
    const response = json({ error: `${SECRET_MARKER} ${TOKEN_MARKER}` }, status);
    const bodySpy = vi.spyOn(response, "json");
    const logSpy = vi.spyOn(console, "error");
    fetchMock.mockResolvedValueOnce(response);
    const error = await getNangoProviders().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(UserError);
    expect(error).toMatchObject({ status: status >= 429 ? 503 : 502 });
    expect(String(error)).not.toContain(TOKEN_MARKER);
    expect(String(error)).not.toContain(SECRET_MARKER);
    expect(bodySpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("sanitizes network and invalid JSON errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error(TOKEN_MARKER));
    await expect(getNangoProviders()).rejects.toMatchObject({ message: expect.not.stringContaining(TOKEN_MARKER) });
    fetchMock.mockResolvedValueOnce(new Response(`invalid-json ${TOKEN_MARKER}`, { status: 200 }));
    await expect(getNangoProviders()).rejects.toMatchObject({ message: expect.not.stringContaining(TOKEN_MARKER) });
  });

  it("rejects an oversized declared response before reading it", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 200, { "content-length": String(2 * 1024 * 1024 + 1) }));
    await expect(getNangoProviders()).rejects.toBeInstanceOf(NangoUnavailableError);
  });

  it("enforces the response limit even without content-length", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); },
      cancel() { cancelled = true; },
    });
    fetchMock.mockResolvedValueOnce(new Response(body));
    await expect(getNangoProviders()).rejects.toBeInstanceOf(NangoUnavailableError);
    expect(cancelled).toBe(true);
  });

  it("sets a ten-second abort deadline on the request", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValueOnce(json({ data: [] }));
    await getNangoProviders();
    expect(timeout).toHaveBeenCalledWith(10_000);
  });
});
