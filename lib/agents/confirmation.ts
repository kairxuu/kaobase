// Contrat partagé avec le chat. Aucun mot-clé ou texte généré n'autorise une suppression.
export type DeletionRequest = {
  id: string;
  kind: "transaction" | "task" | "budget";
  description: string;
  expiresAt: string;
};

// Les badges d'action reflètent les résultats réussis, jamais les simples appels d'outils.
export function successfulToolNames(steps: readonly {
  toolResults: readonly { toolName: string; output: unknown }[];
}[]): string[] {
  return [...new Set(steps.flatMap((step) => step.toolResults.filter(({ output }) => {
    if (output == null) return false;
    if (typeof output !== "object") return true;
    const value = output as Record<string, unknown>;
    return !value.erreur && !value.error && !value.refus && !value.confirmation_requise;
  }).map((r) => r.toolName)))];
}
