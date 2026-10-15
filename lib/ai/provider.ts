import "server-only";
import { createGroq } from "@ai-sdk/groq";
import { createGoogle } from "@ai-sdk/google";
import { generateText, isStepCount, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { env } from "@/lib/env";

// Fournisseurs gratuits, essayés dans l'ordre. Si Groq dépasse son quota ou tombe,
// on bascule sur Gemini sans que l'utilisateur ne voie d'erreur.

export type ProviderChoice = { provider: "groq" | "gemini"; model: string; instance: LanguageModel };

function providers(tier: "smart" | "fast"): ProviderChoice[] {
  const list: ProviderChoice[] = [];
  const groqKey = env.groqKey();
  if (groqKey) {
    const groq = createGroq({ apiKey: groqKey });
    // Le quota gratuit de Groq est compté par modèle : un 2e modèle double la capacité avant Gemini.
    const models = tier === "fast" ? [env.groqFastModel()] : [env.groqModel(), env.groqFallbackModel()];
    for (const model of new Set(models)) list.push({ provider: "groq", model, instance: groq(model) });
  }
  const geminiKey = env.geminiKey();
  if (geminiKey) {
    const google = createGoogle({ apiKey: geminiKey });
    const model = env.geminiModel();
    list.push({ provider: "gemini", model, instance: google(model) });
  }
  return list;
}

export function aiConfigured(): boolean {
  return Boolean(env.groqKey() || env.geminiKey());
}

export class NoProviderError extends Error {
  constructor() {
    super("Aucune clé IA configurée : ajoute GROQ_API_KEY ou GOOGLE_GENERATIVE_AI_API_KEY dans .env.local.");
  }
}

type GenerateOptions = {
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  maxSteps?: number;
  tier?: "smart" | "fast";
};

export async function generateWithFallback(options: GenerateOptions) {
  const candidates = providers(options.tier ?? "smart");
  if (candidates.length === 0) throw new NoProviderError();

  const errors: string[] = [];
  for (const choice of candidates) {
    try {
      const result = await generateText({
        model: choice.instance,
        system: options.system,
        messages: options.messages,
        tools: options.tools,
        stopWhen: isStepCount(options.maxSteps ?? 6),
        temperature: 0.3,
        maxRetries: 2,
      });
      return { result, provider: choice.provider, model: choice.model, fallbackErrors: errors };
    } catch (error) {
      errors.push(`${choice.provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Tous les fournisseurs IA ont échoué — ${errors.join(" | ")}`);
}
