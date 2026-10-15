import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import type { AgentId } from "@/lib/learning/router";
import { embed, toVector } from "./embeddings";
import { UserError } from "@/lib/errors";

// Mémoire des agents : ce que l'utilisateur a dit, corrigé ou validé est réinjecté
// dans les prochains prompts (RAG + few-shot). C'est ce qui fait progresser l'IA gratuite
// sans fine-tuning : le modèle reste le même, son contexte s'enrichit à chaque usage.

export type RecalledContext = {
  memories: { kind: string; content: string; similarity: number }[];
  examples: { input: string; output: string; similarity: number }[];
  embedding: number[] | null;
};

export async function recall(supabase: Supabase, agent: AgentId, query: string): Promise<RecalledContext> {
  const embedding = await embed(query);
  if (!embedding) {
    // Sans embeddings : on garde au moins les corrections et faits les plus récents.
    const { data } = await supabase
      .from("agent_memories")
      .select("kind, content")
      .in("agent", [agent, "shared"])
      .in("kind", ["correction", "fact"])
      .order("created_at", { ascending: false })
      .limit(5);
    return { memories: (data ?? []).map((m) => ({ ...m, similarity: 0 })), examples: [], embedding: null };
  }

  const vector = toVector(embedding);
  const [memories, examples] = await Promise.all([
    supabase.rpc("match_memories", { p_agent: agent, p_embedding: vector, p_count: 6 }),
    supabase.rpc("match_examples", { p_agent: agent, p_embedding: vector, p_count: 3 }),
  ]);
  return {
    memories: (memories.data ?? []) as RecalledContext["memories"],
    examples: (examples.data ?? []) as RecalledContext["examples"],
    embedding,
  };
}

export function contextBlock(context: RecalledContext): string {
  const parts: string[] = [];
  if (context.memories.length) {
    parts.push(
      "## Ce que tu sais déjà de cet utilisateur (mémoire)\n" +
        context.memories.map((m) => `- [${m.kind}] ${m.content}`).join("\n"),
    );
  }
  if (context.examples.length) {
    parts.push(
      "## Réponses validées par l'utilisateur sur des demandes proches (inspire-toi du ton et du format)\n" +
        context.examples.map((e) => `Demande : ${e.input}\nRéponse validée : ${e.output}`).join("\n---\n"),
    );
  }
  return parts.join("\n\n");
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export async function storeExchange(
  supabase: Supabase,
  agent: AgentId,
  input: string,
  output: string,
  inputEmbedding: number[] | null,
) {
  await supabase.from("agent_memories").insert({
    agent,
    kind: "exchange",
    content: `Q : ${truncate(input, 300)} → R : ${truncate(output, 400)}`,
    embedding: toVector(inputEmbedding),
    importance: 1,
  });
}

export async function rememberFact(supabase: Supabase, agent: AgentId | "shared", content: string) {
  const embedding = await embed(content);
  const { error } = await supabase.from("agent_memories").insert({
    agent,
    kind: "fact",
    content: truncate(content, 500),
    embedding: toVector(embedding),
    importance: 1.5,
  });
  if (error) throw error;
}

// 👍 -> la réponse devient un exemple ; correction -> l'exemple porte la version corrigée
// et une mémoire « correction » (poids 2) empêche de refaire la même erreur.
export async function applyFeedback(
  supabase: Supabase,
  runId: string,
  rating: 1 | -1,
  correction: string | null,
) {
  const { data: run, error } = await supabase
    .from("agent_runs")
    .select("id, agent, input, output")
    .eq("id", runId)
    .single();
  if (error || !run) throw new UserError("Exécution introuvable");

  await supabase.from("agent_feedback").upsert({ run_id: runId, rating, correction }, { onConflict: "user_id,run_id" });
  // Un retour remplace le précédent : on repart d'un état propre pour cette exécution.
  await supabase.from("agent_examples").delete().eq("run_id", runId);

  const inputEmbedding = toVector(await embed(run.input));
  const goodOutput = correction?.trim() || (rating === 1 ? run.output : null);
  if (goodOutput) {
    await supabase.from("agent_examples").insert({
      agent: run.agent,
      input: run.input,
      output: truncate(goodOutput, 1500),
      embedding: inputEmbedding,
      run_id: runId,
    });
  }
  if (correction?.trim()) {
    await supabase.from("agent_memories").insert({
      agent: run.agent,
      kind: "correction",
      content: `Pour « ${truncate(run.input, 200)} », l'utilisateur attend : ${truncate(correction, 400)}`,
      embedding: inputEmbedding,
      importance: 2,
    });
  } else if (rating === -1) {
    await supabase.from("agent_memories").insert({
      agent: run.agent,
      kind: "correction",
      content: `Réponse jugée insatisfaisante pour « ${truncate(run.input, 200)} » : « ${truncate(run.output ?? "", 200)} ». Change d'approche.`,
      embedding: inputEmbedding,
      importance: 1.3,
    });
  }
}
