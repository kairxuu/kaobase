export const CONVERSATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type CachedMessage = {
  role: "user" | "assistant";
  content: string;
  agent?: string;
  runId?: string | null;
};
export type ChatSnapshot = {
  messages: CachedMessage[];
  input: string;
  agent: string;
  pendingSince: number | null;
  updatedAt?: number;
};
export const chatStorageKey = (userId: string, id: string) =>
  `kaobase:chat:${userId}:${id}`;
export const chatCookieName = (userId: string) => `kaobase_chat_${userId}`;
export function parseChatSnapshot(raw: string | null): ChatSnapshot | null {
  try {
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (
      !Array.isArray(value.messages) ||
      !value.messages.every(
        (m: CachedMessage) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      ) ||
      typeof value.input !== "string" ||
      typeof value.agent !== "string"
    )
      return null;
    return {
      ...(typeof value.updatedAt === "number"
        ? { updatedAt: value.updatedAt }
        : {}),
      messages: value.messages,
      input: value.input,
      agent: value.agent,
      pendingSince:
        typeof value.pendingSince === "number" ? value.pendingSince : null,
    };
  } catch {
    return null;
  }
}
export function restoredMessages<T extends CachedMessage>(
  server: T[],
  cached: T[],
): T[] {
  if (server.length > cached.length) return server;
  if (
    server.length === cached.length &&
    server.some(
      (m, i) => m.content !== cached[i]?.content || m.role !== cached[i]?.role,
    )
  )
    return server;
  return cached.length ? cached : server;
}
