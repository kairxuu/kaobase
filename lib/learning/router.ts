// Routage d'intention vers l'agent spécialisé.
// Étape 1 (gratuite) : score par mots-clés. Étape 2 (si ambigu) : le LLM tranche — voir lib/agents/orchestrator.ts.

export const AGENT_IDS = ["finance", "subscriptions", "tasks", "imports"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

const KEYWORDS: Record<AgentId, string[]> = {
  finance: [
    "depense", "dépense", "budget", "solde", "revenu", "salaire", "categorie", "catégorie", "argent",
    "economie", "économie", "epargne", "épargne", "prevision", "prévision", "transaction", "combien",
    "mois", "paye", "payé", "restaurant", "courses", "compte",
  ],
  subscriptions: [
    "abonnement", "abonne", "abonné", "recurrent", "récurrent", "netflix", "spotify", "resilier",
    "résilier", "resiliation", "résiliation", "prelevement", "prélèvement", "renouvellement", "mensualite",
    "mensualité", "echeance", "échéance", "forfait",
  ],
  tasks: [
    "tache", "tâche", "todo", "a faire", "à faire", "rappel", "rappelle", "planifie", "planifier",
    "priorite", "priorité", "deadline", "organiser", "agenda", "terminer", "termine",
  ],
  imports: [
    "import", "importer", "csv", "ofx", "fichier", "releve", "relevé", "doublon", "colonne",
    "qualite", "qualité", "non categorise", "non catégorisé",
  ],
};

function normalize(s: string): string {
  return " " + s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ") + " ";
}

const NORMALIZED = Object.fromEntries(
  AGENT_IDS.map((id) => [id, [...new Set(KEYWORDS[id].map((k) => normalize(k).trim()))]]),
) as Record<AgentId, string[]>;

export function routeByKeywords(message: string): { agent: AgentId | null; scores: Record<AgentId, number> } {
  const text = normalize(message);
  const scores = Object.fromEntries(AGENT_IDS.map((id) => [id, 0])) as Record<AgentId, number>;
  for (const id of AGENT_IDS) {
    for (const kw of NORMALIZED[id]) {
      // Préfixe de mot : "abonnements" matche "abonnement".
      if (text.includes(" " + kw)) scores[id] += kw.includes(" ") ? 2 : 1;
    }
  }
  const ranked = [...AGENT_IDS].sort((a, b) => scores[b] - scores[a]);
  const [best, second] = ranked;
  // Ambigu (aucun mot-clé ou égalité) : on laisse le LLM décider.
  if (scores[best] === 0 || scores[best] === scores[second]) return { agent: null, scores };
  return { agent: best, scores };
}
