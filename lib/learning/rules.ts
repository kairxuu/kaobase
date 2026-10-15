// Règles de catégorisation apprises : marchand -> catégorie.
// Elles passent AVANT le LLM : une règle fiable catégorise gratuitement et instantanément,
// le LLM ne traite que les marchands inconnus. Chaque correction de l'utilisateur ajuste les règles.

export type Rule = {
  merchant: string;
  categoryId: string;
  source: "user" | "llm";
  hits: number;
  misses: number;
};

export const APPLY_THRESHOLD = 0.5;

// Lissage de Laplace, identique à la colonne générée `confidence` en base.
export function ruleConfidence(rule: Pick<Rule, "hits" | "misses">): number {
  return (rule.hits + 1) / (rule.hits + rule.misses + 2);
}

export function applicableRule(rule: Rule | undefined): Rule | undefined {
  return rule && ruleConfidence(rule) >= APPLY_THRESHOLD ? rule : undefined;
}

// Nouvel état d'une règle après que l'utilisateur a choisi `categoryId` pour `merchant`.
export function learnFromUser(existing: Rule | undefined, merchant: string, categoryId: string): Rule {
  if (!existing) return { merchant, categoryId, source: "user", hits: 1, misses: 0 };
  if (existing.categoryId === categoryId) {
    return { ...existing, source: "user", hits: existing.hits + 1 };
  }
  const misses = existing.misses + 1;
  // Une suggestion du LLM contredite, ou une règle qui se trompe aussi souvent qu'elle a raison,
  // est remplacée par le choix de l'utilisateur.
  if (existing.source === "llm" || misses >= existing.hits) {
    return { merchant, categoryId, source: "user", hits: 1, misses: 0 };
  }
  return { ...existing, misses };
}

// Une suggestion du LLM ne crée une règle que si aucune n'existe : elle démarre à confiance 0.5.
export function learnFromLlm(existing: Rule | undefined, merchant: string, categoryId: string): Rule | undefined {
  if (existing) return undefined;
  return { merchant, categoryId, source: "llm", hits: 0, misses: 0 };
}
