import { describe, expect, it } from "vitest";
import {
  chatStorageKey,
  chatCookieName,
  parseChatSnapshot,
  restoredMessages,
} from "@/lib/chat-storage";
const user = { role: "user" as const, content: "Mon budget ?" };
const assistant = { role: "assistant" as const, content: "Voici le budget." };
describe("reprise de conversation", () => {
  it("isole les brouillons par utilisateur et par conversation", () => {
    expect(chatStorageKey("alice", "a")).not.toBe(chatStorageKey("bob", "a"));
    expect(chatStorageKey("alice", "a")).not.toBe(chatStorageKey("alice", "b"));
    expect(chatCookieName("alice")).not.toBe(chatCookieName("bob"));
  });
  it("retrouve le brouillon, l’agent et une réponse encore en cours", () => {
    const value = {
      messages: [user],
      input: "Et le mois prochain ?",
      agent: "finance",
      pendingSince: 123,
    };
    expect(parseChatSnapshot(JSON.stringify(value))).toEqual(value);
  });
  it.each([
    null,
    "{",
    "{}",
    '{"messages":[{"role":"system","content":"x"}],"input":"","agent":"auto"}',
  ])("ignore un stockage invalide", (raw) =>
    expect(parseChatSnapshot(raw)).toBeNull(),
  );
  it("ne remplace pas une question non encore enregistrée par un historique plus ancien", () => {
    expect(restoredMessages([], [user])).toEqual([user]);
  });
  it("préfère une nouvelle réponse serveur à la question locale en attente", () => {
    expect(restoredMessages([user, assistant], [user])).toEqual([
      user,
      assistant,
    ]);
  });
  it("conserve les métadonnées locales lorsque le texte correspond au serveur", () => {
    const cached = [user, { ...assistant, agent: "finance" }];
    expect(restoredMessages([user, assistant], cached)).toBe(cached);
  });
  it("préfère le serveur quand le contenu à longueur égale a changé", () => {
    expect(
      restoredMessages(
        [user, assistant],
        [user, { ...assistant, content: "Ancienne réponse" }],
      ),
    ).toEqual([user, assistant]);
  });
});
