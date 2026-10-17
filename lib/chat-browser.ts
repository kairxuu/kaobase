import {
  chatCookieName,
  chatStorageKey,
  CONVERSATION_ID,
  parseChatSnapshot,
  type ChatSnapshot,
} from "./chat-storage";
export const STORAGE_FAILURE = "kaobase-chat-storage-failure";
export const CACHE_UPDATED = "kaobase-chat-cache-updated";
export function readChatCache(key: string): {
  value: ChatSnapshot | null;
  available: boolean;
} {
  try {
    return {
      value: parseChatSnapshot(localStorage.getItem(key)),
      available: true,
    };
  } catch {
    return { value: null, available: false };
  }
}
export function writeChatCache(key: string, value: ChatSnapshot) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ ...value, updatedAt: Date.now() }),
    );
    window.dispatchEvent(new Event(CACHE_UPDATED));
  } catch {
    window.dispatchEvent(new Event(STORAGE_FAILURE));
  }
}
export function rememberConversation(userId: string, id: string) {
  document.cookie = `${chatCookieName(userId)}=${id}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}
export const browserClock = () => Date.now();

export function cachedConversations(userId: string) {
  const result: {
    id: string;
    title: string;
    agent: string;
    lastAt: string;
    messages: number;
    pending: boolean;
  }[] = [];
  const prefix = chatStorageKey(userId, "");
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (!CONVERSATION_ID.test(id)) continue;
      const cached = parseChatSnapshot(localStorage.getItem(key));
      if (!cached) continue;
      const title = (
        cached.messages.find((m) => m.role === "user")?.content ?? cached.input
      )
        .trim()
        .slice(0, 80);
      if (!title) continue;
      result.push({
        id,
        title,
        agent: cached.agent,
        lastAt: new Date(cached.updatedAt ?? 0).toISOString(),
        messages: cached.messages.filter((m) => m.role === "user").length,
        pending: Boolean(
          cached.pendingSince && Date.now() - cached.pendingSince < 90000,
        ),
      });
    }
  } catch {
    return result;
  }
  return result.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
