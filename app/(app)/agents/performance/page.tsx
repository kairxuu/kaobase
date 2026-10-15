import { requireUser } from "@/lib/auth";
import { AGENTS } from "@/lib/agents/definitions";
import type { AgentId } from "@/lib/learning/router";
import { shortDate } from "@/lib/ui/format";

type PerfRow = {
  agent: AgentId | "orchestrator";
  runs: number;
  errors: number;
  avg_latency_ms: number | null;
  tokens: number;
  thumbs_up: number;
  thumbs_down: number;
  avg_memories: number | null;
  avg_examples: number | null;
  last_run_at: string | null;
};

export default async function PerformancePage() {
  const { supabase } = await requireUser();
  const count = (table: string, filter?: [string, string]) => {
    let q = supabase.from(table).select("id", { count: "exact", head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    return q.then((r) => r.count ?? 0);
  };

  const [{ data: perf }, rules, userRules, memories, corrections, facts, examples, byRule, byLlm, byUser, none] = await Promise.all([
    supabase.from("agent_performance").select("*"),
    count("categorization_rules"),
    count("categorization_rules", ["source", "user"]),
    count("agent_memories"),
    count("agent_memories", ["kind", "correction"]),
    count("agent_memories", ["kind", "fact"]),
    count("agent_examples"),
    count("transactions", ["categorized_by", "rule"]),
    count("transactions", ["categorized_by", "llm"]),
    count("transactions", ["categorized_by", "user"]),
    supabase.from("transactions").select("id", { count: "exact", head: true }).is("categorized_by", null).then((r) => r.count ?? 0),
  ]);

  const rows = (perf ?? []) as PerfRow[];
  const totalCat = byRule + byLlm + byUser + none;
  const pct = (n: number) => (totalCat ? Math.round((n / totalCat) * 100) : 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Performance IA</h1>
        <p className="text-sm text-ink-2">
          Ce que KAOBASE a appris de toi, et comment chaque agent s&apos;en sert. Plus il y a de règles et d&apos;exemples validés, moins
          l&apos;IA a besoin de deviner.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Règles de catégorisation" value={rules} hint={`${userRules} confirmées par toi`} />
        <Stat label="Exemples validés" value={examples} hint="réutilisés en few-shot" />
        <Stat label="Souvenirs" value={memories} hint={`${corrections} corrections · ${facts} faits`} />
        <Stat label="Résolu sans IA" value={`${pct(byRule + byUser)} %`} hint="des transactions catégorisées par règles ou par toi" />
      </section>

      <section className="card">
        <h2 className="card-title">Qui catégorise tes transactions</h2>
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
          <div style={{ width: `${pct(byRule)}%` }} className="bg-accent" title="Règles" />
          <div style={{ width: `${pct(byUser)}%` }} className="bg-pos" title="Toi" />
          <div style={{ width: `${pct(byLlm)}%` }} className="bg-warn" title="IA" />
        </div>
        <ul className="mt-3 flex flex-wrap gap-4 text-xs text-ink-2">
          <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent" />Règles apprises {byRule}</li>
          <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-pos" />Toi {byUser}</li>
          <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warn" />IA {byLlm}</li>
          <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-surface-2" />Non catégorisées {none}</li>
        </ul>
      </section>

      <section className="card overflow-x-auto p-0">
        <h2 className="card-title px-5 pt-5">Par agent</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th className="text-right">Appels</th>
              <th className="text-right">Satisfaction</th>
              <th className="text-right">Latence moy.</th>
              <th className="text-right">Mémoire / exemples moy.</th>
              <th className="text-right">Erreurs</th>
              <th>Dernier appel</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-3">Aucun appel pour l&apos;instant.</td>
              </tr>
            )}
            {rows.map((r) => {
              const rated = r.thumbs_up + r.thumbs_down;
              return (
                <tr key={r.agent}>
                  <td className="font-medium">{r.agent === "orchestrator" ? "Orchestrateur" : AGENTS[r.agent].name}</td>
                  <td className="num text-right">{r.runs}</td>
                  <td className="num text-right">
                    {rated ? `${Math.round((r.thumbs_up / rated) * 100)} %` : "—"}
                    <span className="ml-1 text-xs text-ink-3">({r.thumbs_up}👍 {r.thumbs_down}👎)</span>
                  </td>
                  <td className="num text-right">{r.avg_latency_ms != null ? `${(r.avg_latency_ms / 1000).toFixed(1)} s` : "—"}</td>
                  <td className="num text-right">{Number(r.avg_memories ?? 0).toFixed(1)} / {Number(r.avg_examples ?? 0).toFixed(1)}</td>
                  <td className={`num text-right ${r.errors ? "text-neg" : ""}`}>{r.errors}</td>
                  <td className="text-ink-2">{shortDate(r.last_run_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div className="card">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="num mt-1 text-xl font-semibold">{value}</p>
      <p className="mt-0.5 text-xs text-ink-3">{hint}</p>
    </div>
  );
}
