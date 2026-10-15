import "server-only";
import type { Supabase } from "@/lib/supabase/server";

export type RunRecord = {
  agent: "orchestrator" | "finance" | "subscriptions" | "tasks" | "imports";
  routedBy?: "user" | "keywords" | "llm" | null;
  provider?: string | null;
  model?: string | null;
  input: string;
  output?: string | null;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  toolCalls?: number;
  memoriesUsed?: number;
  examplesUsed?: number;
  error?: string | null;
};

// Chaque appel IA est journalisé : c'est la matière première des métriques et de l'apprentissage.
export async function recordRun(supabase: Supabase, run: RunRecord): Promise<string | null> {
  const { data } = await supabase
    .from("agent_runs")
    .insert({
      agent: run.agent,
      routed_by: run.routedBy ?? null,
      provider: run.provider ?? null,
      model: run.model ?? null,
      input: run.input.slice(0, 4000),
      output: run.output?.slice(0, 8000) ?? null,
      latency_ms: run.latencyMs,
      input_tokens: run.inputTokens ?? null,
      output_tokens: run.outputTokens ?? null,
      tool_calls: run.toolCalls ?? 0,
      memories_used: run.memoriesUsed ?? 0,
      examples_used: run.examplesUsed ?? 0,
      error: run.error?.slice(0, 2000) ?? null,
    })
    .select("id")
    .single();
  return (data?.id as string | undefined) ?? null;
}
