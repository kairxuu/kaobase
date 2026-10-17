import type { Metadata } from "next";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { aiConfigured } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { AGENTS } from "@/lib/agents/definitions";
import { getConversation, listConversations } from "@/lib/data/agents";
import { AGENT_IDS } from "@/lib/learning/router";
import { pendingDeletions } from "@/lib/agents/deletions";
import { chatCookieName, CONVERSATION_ID } from "@/lib/chat-storage";
import { Chat } from "./chat";
import "./chat.css";
export const metadata: Metadata = { title: "Assistant IA" };
export default async function AgentsPage({
  searchParams,
}: PageProps<"/agents">) {
  const { db, userId } = await requireUser();
  const params = await searchParams;
  const [conversations, cookieStore] = await Promise.all([
    listConversations(db),
    cookies(),
  ]);
  const remembered = cookieStore.get(chatCookieName(userId))?.value;
  const current =
    typeof params.c === "string" && CONVERSATION_ID.test(params.c)
      ? params.c
      : remembered && CONVERSATION_ID.test(remembered)
        ? remembered
        : (conversations[0]?.id ?? randomUUID());
  const [stored, deletions] = await Promise.all([
    getConversation(db, current),
    pendingDeletions(db, current),
  ]);
  const agents = AGENT_IDS.map((id) => ({
    id,
    name: AGENTS[id].name,
    tagline: AGENTS[id].tagline,
  }));
  return (
    <Chat
      key={current}
      userId={userId}
      agents={agents}
      conversations={conversations}
      enabled={aiConfigured()}
      initialConversationId={current}
      initialMessages={stored}
      initialDeletions={deletions}
    />
  );
}
