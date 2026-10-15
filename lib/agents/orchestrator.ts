import "server-only";
import type { ModelMessage } from "ai";
import type { Supabase } from "@/lib/supabase/server";
import { AGENT_IDS, routeByKeywords, type AgentId } from "@/lib/learning/router";
import { contextBlock, recall, storeExchange } from "@/lib/learning/memory";
import { generateWithFallback } from "@/lib/ai/provider";
import { systemPrompt } from "./definitions";
import { loadToolContext, toolsFor } from "./tools";
import { isExplicitConfirmation } from "./confirmation";
import { recordRun } from "./runs";

export type AgentReply = {
  agent: AgentId;
  routedBy: "user" | "keywords" | "llm";
  text: string;
  runId: string | null;
  provider: string | null;
  memoriesUsed: number;
  examplesUsed: number;
  toolsUsed: string[];
};

// 1) mots-clés (gratuit), 2) petit modèle rapide si ambigu, 3) Finance par défaut.
async function route(supabase: Supabase, message: string): Promise<{ agent: AgentId; routedBy: "keywords" | "llm" }> {
  const byKeywords = routeByKeywords(message);
  if (byKeywords.agent) return { agent: byKeywords.agent, routedBy: "keywords" };

  const started = Date.now();
  try {
    const { result, provider, model } = await generateWithFallback({
      tier: "fast",
      system:
        "Classe la demande dans UN secteur : finance (dépenses, budget, solde), subscriptions (abonnements récurrents), " +
        "tasks (tâches, rappels, organisation), imports (relevés CSV/OFX, qualité des données). Réponds par le seul mot du secteur.",
      messages: [{ role: "user", content: message }],
    });
    const word = result.text.toLowerCase();
    const agent = AGENT_IDS.find((id) => word.includes(id)) ?? "finance";
    await recordRun(supabase, {
      agent: "orchestrator",
      routedBy: "llm",
      provider,
      model,
      input: message,
      output: agent,
      latencyMs: Date.now() - started,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });
    return { agent, routedBy: "llm" };
  } catch {
    return { agent: "finance", routedBy: "llm" };
  }
}

export async function askAgent(
  supabase: Supabase,
  input: { message: string; agent: AgentId | "auto"; conversationId: string; currency: string },
): Promise<AgentReply> {
  const { agent, routedBy } =
    input.agent === "auto" ? await route(supabase, input.message) : { agent: input.agent, routedBy: "user" as const };

  const [context, toolContext, history] = await Promise.all([
    recall(supabase, agent, input.message),
    loadToolContext(supabase, isExplicitConfirmation(input.message)),
    supabase
      .from("agent_messages")
      .select("role, content")
      .eq("conversation_id", input.conversationId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const messages: ModelMessage[] = [
    ...((history.data ?? []).reverse() as { role: "user" | "assistant"; content: string }[]).map(
      (m) => ({ role: m.role, content: m.content }) as ModelMessage,
    ),
    { role: "user", content: input.message },
  ];

  const started = Date.now();
  let text = "";
  let runId: string | null = null;
  let provider: string | null = null;
  const toolsUsed: string[] = [];

  try {
    const generated = await generateWithFallback({
      system: systemPrompt(agent, contextBlock(context), input.currency),
      messages,
      tools: toolsFor(agent, supabase, toolContext),
      maxSteps: 10,
    });
    const { result } = generated;
    provider = generated.provider;
    for (const step of result.steps) for (const call of step.toolCalls) toolsUsed.push(call.toolName);
    text = result.text.trim() || "C'est fait.";
    runId = await recordRun(supabase, {
      agent,
      routedBy,
      provider: generated.provider,
      model: generated.model,
      input: input.message,
      output: text,
      latencyMs: Date.now() - started,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      toolCalls: toolsUsed.length,
      memoriesUsed: context.memories.length,
      examplesUsed: context.examples.length,
      error: generated.fallbackErrors.length ? `fallback: ${generated.fallbackErrors.join(" | ")}` : null,
    });
    await storeExchange(supabase, agent, input.message, text, context.embedding);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[kaobase] agent ${agent} en échec :`, message);
    runId = await recordRun(supabase, {
      agent,
      routedBy,
      input: input.message,
      latencyMs: Date.now() - started,
      error: message,
    });
    text = `Je n'ai pas pu répondre : ${message}`;
  }

  await supabase.from("agent_messages").insert([
    // Horodatages explicites : l'ordre de l'historique ne dépend pas de l'insertion groupée.
    { conversation_id: input.conversationId, agent, role: "user", content: input.message, created_at: new Date(started).toISOString() },
    { conversation_id: input.conversationId, agent, role: "assistant", content: text, run_id: runId, created_at: new Date().toISOString() },
  ]);

  return {
    agent,
    routedBy,
    text,
    runId,
    provider,
    memoriesUsed: context.memories.length,
    examplesUsed: context.examples.length,
    toolsUsed,
  };
}
