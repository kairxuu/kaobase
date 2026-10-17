import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedConversations,
  readChatCache,
  writeChatCache,
  STORAGE_FAILURE,
} from "@/lib/chat-browser";
import { chatStorageKey } from "@/lib/chat-storage";
let entries: Map<string, string>;
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(() => {
  entries = new Map();
  vi.stubGlobal("localStorage", {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  });
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());
describe("brouillons dans l’historique", () => {
  it("retrouve une conversation avec uniquement un message non envoyé", () => {
    writeChatCache(chatStorageKey("alice", id), {
      messages: [],
      input: "Mon livret A",
      agent: "auto",
      pendingSince: null,
    });
    expect(cachedConversations("alice")).toMatchObject([
      { id, title: "Mon livret A", messages: 0 },
    ]);
  });
  it("ignore les conversations vides et celles d’un autre compte", () => {
    writeChatCache(chatStorageKey("bob", id), {
      messages: [],
      input: "Privé",
      agent: "auto",
      pendingSince: null,
    });
    writeChatCache(chatStorageKey("alice", id), {
      messages: [],
      input: " ",
      agent: "auto",
      pendingSince: null,
    });
    expect(cachedConversations("alice")).toEqual([]);
  });
  it("utilise la première question comme titre même si un brouillon suivant existe", () => {
    writeChatCache(chatStorageKey("alice", id), {
      messages: [{ role: "user", content: "Question initiale" }],
      input: "Question suivante",
      agent: "auto",
      pendingSince: null,
    });
    expect(cachedConversations("alice")[0].title).toBe("Question initiale");
  });
  it("signale le stockage indisponible sans planter le chat", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("Blocked");
      },
      setItem() {
        throw new Error("Quota");
      },
    });
    const listener = vi.fn();
    window.addEventListener(STORAGE_FAILURE, listener);
    expect(readChatCache("key").available).toBe(false);
    expect(() =>
      writeChatCache("key", {
        messages: [],
        input: "brouillon",
        agent: "auto",
        pendingSince: null,
      }),
    ).not.toThrow();
    expect(listener).toHaveBeenCalledOnce();
  });
});
