import { aiConfigured } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { AGENTS } from "@/lib/agents/definitions";
import { AGENT_IDS } from "@/lib/learning/router";
import { Chat } from "./chat";

export default async function AgentsPage() {
  await requireUser();
  const agents = AGENT_IDS.map((id) => ({ id, name: AGENTS[id].name, tagline: AGENTS[id].tagline }));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="page-title">Agents</h1>
        <p className="page-lede">
          Quatre agents, un par domaine. Pose ta question, Kaobase choisit le bon. Quand une réponse te convient ou que tu la
          corriges, l&apos;agent s&apos;en sert pour les questions suivantes.
        </p>
      </header>
      {!aiConfigured() && (
        <div className="rounded-md bg-warn-soft p-4 text-sm">
          Aucune clé IA configurée. Ajoute <code>GROQ_API_KEY</code> (et/ou <code>GOOGLE_GENERATIVE_AI_API_KEY</code>) dans{" "}
          <code>.env.local</code>, puis redémarre le serveur.
        </div>
      )}
      <Chat agents={agents} />
    </div>
  );
}
