import { expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
vi.mock("server-only", () => ({}));
vi.mock("@/app/(app)/actions", () => ({ deleteConversationAction: vi.fn() }));
import { Chat } from "@/app/(app)/agents/chat";
it("rend un état de chargement cohérent côté serveur avant de lire le cache du navigateur", () => {
  const html = renderToString(
    React.createElement(Chat, {
      userId: "user",
      agents: [],
      conversations: [],
      initialConversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
  );
  expect(html).toContain("Ouverture de la conversation");
  expect(html).toContain('aria-busy="true"');
});
