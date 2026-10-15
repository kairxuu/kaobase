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
        <h1 className="text-2xl font-semibold tracking-tight">Agents IA</h1>
        <p className="text-sm text-ink-2">
          Un agent spécialisé par secteur. En mode Auto, l&apos;orchestrateur choisit pour toi. Note les réponses : chaque 👍 ou
          correction devient un exemple que l&apos;agent réutilisera.
        </p>
      </header>
      {!aiConfigured() && (
        <div className="card border-warn bg-warn-soft text-sm">
          Aucune clé IA configurée. Ajoute <code>GROQ_API_KEY</code> (et/ou <code>GOOGLE_GENERATIVE_AI_API_KEY</code>) dans{" "}
          <code>.env.local</code>, puis redémarre le serveur.
        </div>
      )}
      <Chat agents={agents} />
    </div>
  );
}
