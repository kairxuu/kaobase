import { requireUser } from "@/lib/auth";
import { AGENTS } from "@/lib/agents/definitions";
import type { AgentId } from "@/lib/learning/router";
import { shortDate } from "@/lib/ui/format";
import { countExchanges, listMemories } from "@/lib/data/agents";
import { clearExchangesAction, deleteMemoryAction } from "../../actions";
import { ActionButton } from "../../_components/action-button";

const KIND_LABEL: Record<string, string> = {
  fact: "préférence",
  correction: "correction",
  example: "réponse validée",
};

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
  const { db } = await requireUser();
  const count = (table: string, filter?: [string, string]) => {
    let q = db.from(table).select("id", { count: "exact", head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    return q.then((r) => r.count ?? 0);
  };

  const [items, exchanges] = await Promise.all([listMemories(db), countExchanges(db)]);
  const [{ data: perf }, rules, userRules, memories, corrections, facts, examples, byRule, byLlm, byUser, none] = await Promise.all([
    db.from("agent_performance").select("*"),
    count("categorization_rules"),
    count("categorization_rules", ["source", "user"]),
    count("agent_memories"),
    count("agent_memories", ["kind", "correction"]),
    count("agent_memories", ["kind", "fact"]),
    count("agent_examples"),
    count("transactions", ["categorized_by", "rule"]),
    count("transactions", ["categorized_by", "llm"]),
    count("transactions", ["categorized_by", "user"]),
    db.from("transactions").select("id", { count: "exact", head: true }).is("categorized_by", null).then((r) => r.count ?? 0),
  ]);

  const rows = (perf ?? []) as PerfRow[];
  const totalCat = byRule + byLlm + byUser + none;
  const pct = (n: number) => (totalCat ? Math.round((n / totalCat) * 100) : 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Ce qu&apos;ils ont appris</h1>
        <p className="page-lede">
          Chaque correction et chaque réponse validée s&apos;ajoutent ici. Plus il y en a, moins les agents ont besoin de deviner.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat label="Commerçants reconnus" value={rules} hint={`dont ${userRules} choisis par toi`} />
        <Stat label="Réponses validées" value={examples} hint="servent de modèle aux agents" />
        <Stat label="Souvenirs" value={memories} hint={`dont ${corrections} corrections et ${facts} préférences`} />
        <Stat label="Triées sans IA" value={`${pct(byRule + byUser)} %`} hint="des opérations, grâce à tes choix" />
      </section>

      <section>
        <h2 className="section-title">Qui trie tes opérations</h2>
        <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
          <div style={{ width: `${pct(byRule)}%` }} className="bg-accent" title="Règles" />
          <div style={{ width: `${pct(byUser)}%` }} className="bg-pos" title="Toi" />
          <div style={{ width: `${pct(byLlm)}%` }} className="bg-warn" title="IA" />
        </div>
        <ul className="mt-3 flex flex-wrap gap-4 text-xs text-ink-2">
          <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-accent" />Tes choix, réappliqués : {byRule}</li>
          <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-pos" />Toi, directement : {byUser}</li>
          <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warn" />L&apos;IA : {byLlm}</li>
          <li><span className="mr-1.5 inline-block h-2 w-2 rounded-full border border-line" />Pas encore triées : {none}</li>
        </ul>
      </section>

      <section className="overflow-x-auto">
        <h2 className="section-title">Agent par agent</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th className="text-right">Questions</th>
              <th className="text-right">Réponses appréciées</th>
              <th className="text-right">Temps de réponse</th>
              <th className="text-right">Souvenirs utilisés</th>
              <th className="text-right">Erreurs</th>
              <th>Dernière question</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-3">Aucune question posée pour l&apos;instant.</td>
              </tr>
            )}
            {rows.map((r) => {
              const rated = r.thumbs_up + r.thumbs_down;
              return (
                <tr key={r.agent}>
                  <td className="font-medium">{r.agent === "orchestrator" ? "Aiguillage" : AGENTS[r.agent].name}</td>
                  <td className="num text-right">{r.runs}</td>
                  <td className="num text-right">
                    {rated ? `${Math.round((r.thumbs_up / rated) * 100)} %` : "—"}
                    <span className="ml-1 text-xs text-ink-3">sur {rated}</span>
                  </td>
                  <td className="num text-right">{r.avg_latency_ms != null ? `${(r.avg_latency_ms / 1000).toFixed(1)} s` : "—"}</td>
                  <td className="num text-right">{(Number(r.avg_memories ?? 0) + Number(r.avg_examples ?? 0)).toFixed(1)}</td>
                  <td className={`num text-right ${r.errors ? "text-neg" : ""}`}>{r.errors}</td>
                  <td className="text-ink-2">{shortDate(r.last_run_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section id="memoire">
        <h2 className="section-title">Ce que les agents retiennent de toi</h2>
        <p className="mb-3 max-w-[62ch] text-sm text-ink-2">
          Préférences, corrections et réponses validées réutilisées par les agents. Efface ce qui est faux ou que tu ne veux plus
          qu&apos;ils utilisent.
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-ink-3">Rien pour l&apos;instant. Note une réponse ou corrige un agent pour qu&apos;il apprenne.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((m) => (
              <li key={`${m.type}-${m.id}`} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="break-words">{m.content}</p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {KIND_LABEL[m.kind] ?? m.kind}, {m.agent === "shared" ? "tous les agents" : `agent ${AGENTS[m.agent as AgentId]?.name ?? m.agent}`},{" "}
                    {shortDate(m.createdAt)}
                  </p>
                </div>
                <ActionButton action={deleteMemoryAction.bind(null, m.id, m.type)} className="btn-ghost btn-sm shrink-0">
                  Oublier
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
        {exchanges > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-2 px-4 py-3 text-sm">
            <span>
              Les agents gardent aussi le résumé de {exchanges} échange{exchanges > 1 ? "s" : ""} pour retrouver le contexte.
            </span>
            <ActionButton
              action={clearExchangesAction}
              confirm="Effacer tous les échanges mémorisés ? Préférences, corrections et réponses validées sont conservées."
            >
              Effacer les échanges
            </ActionButton>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div className="border-t border-line pt-3">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="figure mt-1 text-4xl">{value}</p>
      <p className="mt-1 text-xs text-ink-3">{hint}</p>
    </div>
  );
}
