import type { Metadata } from "next";
import Link from "next/link";
import { aiConfigured } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { AGENTS } from "@/lib/agents/definitions";
import { getConversation, listConversations } from "@/lib/data/agents";
import { AGENT_IDS, type AgentId } from "@/lib/learning/router";
import { shortDate } from "@/lib/ui/format";
import { deleteConversationAction } from "../actions";
import { ActionButton } from "../_components/action-button";
import { Chat } from "./chat";
import { pendingDeletions } from "@/lib/agents/deletions";

export const metadata: Metadata = { title: "Agents" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const { supabase } = await requireUser();
  const params = await searchParams;
  const current = typeof params.c === "string" && UUID.test(params.c) ? params.c : undefined;
  const [conversations, stored, deletions] = await Promise.all([
    listConversations(supabase),
    current ? getConversation(supabase, current) : Promise.resolve([]),
    current ? pendingDeletions(supabase, current) : Promise.resolve([]),
  ]);
  const agents = AGENT_IDS.map((id) => ({ id, name: AGENTS[id].name, tagline: AGENTS[id].tagline }));
  const agentName = (id: string) => AGENTS[id as AgentId]?.name ?? "Agent";

  return (
    <div className="space-y-4">
      <header>
        <h1 className="page-title">Agents</h1>
        <p className="page-lede">
          Quatre agents, un par domaine. Pose ta question ou dicte tes dépenses : Kaobase choisit le bon agent. Quand une
          réponse te convient ou que tu la corriges, l&apos;agent s&apos;en sert pour les questions suivantes.
        </p>
      </header>
      {!aiConfigured() && (
        <div className="rounded-md bg-warn-soft p-4 text-sm">
          Aucune clé IA configurée. Ajoute <code>GROQ_API_KEY</code> (et/ou <code>GOOGLE_GENERATIVE_AI_API_KEY</code>) dans{" "}
          <code>.env.local</code>, puis redémarre le serveur.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        {/* Une clé par conversation : rouvrir une conversation repart de son historique. */}
        <Chat
          key={current ?? "new"}
          agents={agents}
          initialConversationId={current}
          initialMessages={stored.map((m) => ({ role: m.role, content: m.content, agent: m.agent, runId: m.runId }))}
          initialDeletions={deletions}
        />
        <aside aria-label="Conversations précédentes">
          <h2 className="section-title">Conversations précédentes</h2>
          {conversations.length === 0 ? (
            <p className="text-sm text-ink-3">Tes conversations apparaîtront ici.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id} className={`group rounded-md px-2 py-1.5 ${c.id === current ? "bg-accent-soft" : "hover:bg-surface-2"}`}>
                  <Link href={`/agents?c=${c.id}`} className="block text-sm leading-snug">
                    <span className="line-clamp-2">{c.title}</span>
                    <span className="text-xs text-ink-3">
                      {agentName(c.agent)}, {shortDate(c.lastAt)}
                    </span>
                  </Link>
                  <ActionButton
                    action={deleteConversationAction.bind(null, c.id)}
                    className="mt-1 text-xs text-ink-3 hover:text-neg"
                    confirm="Supprimer cette conversation ? Les souvenirs déjà retenus par les agents restent."
                  >
                    Supprimer
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
