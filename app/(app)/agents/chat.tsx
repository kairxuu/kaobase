"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "./markdown";
import type { DeletionRequest } from "@/lib/agents/confirmation";

type AgentOption = { id: string; name: string; tagline: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  agent?: string;
  runId?: string | null;
  meta?: { routedBy: string; memoriesUsed: number; examplesUsed: number; toolsUsed: string[]; provider: string | null };
  rating?: 1 | -1;
};

const SUGGESTIONS = [
  "J'ai payé 23 € au restaurant hier et 60 € de courses aujourd'hui",
  "Combien j'ai dépensé en restaurants ce mois-ci ?",
  "Mets un budget de 300 € par mois pour l'alimentation",
  "Quels abonnements pourrais-je couper pour économiser ?",
  "Rappelle-moi de résilier ma salle de sport avant vendredi",
  "Compare mes dépenses de ce mois avec le mois dernier",
];

// Ce que l'agent a consulté, dit en clair au-dessus de la réponse.
const READ_LABEL: Record<string, string> = {
  resume_mois: "le résumé du mois",
  comparer_mois: "deux mois côte à côte",
  top_commercants: "tes principaux commerçants",
  rechercher_operations: "tes opérations",
  soldes: "tes soldes",
  prevision: "la prévision de solde",
  suivi_budgets: "tes budgets",
  lister_abonnements: "tes abonnements",
  cout_total_abonnements: "le coût de tes abonnements",
  pistes_economies: "les pistes d'économies",
  detecter_abonnements: "tes paiements réguliers",
  lister_taches: "tes tâches",
  historique_imports: "tes imports",
  controle_qualite: "la qualité de tes données",
};

// Ce que l'agent a modifié, avec la page où le vérifier.
const ACTIONS: Record<string, { done: string; href: string; link: string }> = {
  ajouter_operations: { done: "a enregistré des opérations", href: "/transactions", link: "Voir les opérations" },
  modifier_operation: { done: "a corrigé une opération", href: "/transactions", link: "Voir les opérations" },
  supprimer_operation: { done: "a supprimé une opération", href: "/transactions", link: "Voir les opérations" },
  categoriser_operation: { done: "a changé une catégorie", href: "/transactions", link: "Voir les opérations" },
  categoriser_non_classees: { done: "a trié des opérations", href: "/transactions", link: "Voir les opérations" },
  creer_categorie: { done: "a créé une catégorie", href: "/settings", link: "Voir les réglages" },
  creer_compte: { done: "a ajouté un compte", href: "/settings", link: "Voir les réglages" },
  definir_budget: { done: "a fixé un budget", href: "/", link: "Voir la vue d'ensemble" },
  supprimer_budget: { done: "a retiré un budget", href: "/", link: "Voir la vue d'ensemble" },
  creer_abonnement: { done: "a ajouté un abonnement", href: "/subscriptions", link: "Voir les abonnements" },
  modifier_abonnement: { done: "a mis à jour un abonnement", href: "/subscriptions", link: "Voir les abonnements" },
  creer_taches: { done: "a créé des tâches", href: "/tasks", link: "Voir les tâches" },
  modifier_tache: { done: "a mis à jour une tâche", href: "/tasks", link: "Voir les tâches" },
  supprimer_tache: { done: "a supprimé une tâche", href: "/tasks", link: "Voir les tâches" },
  planifier_rappels_abonnements: { done: "a créé des rappels", href: "/tasks", link: "Voir les tâches" },
  memoriser: { done: "a retenu une information", href: "/agents/performance", link: "Voir ce qu'ils ont appris" },
};

function frenchList(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`;
}

function describe(agentName: string, meta: NonNullable<Message["meta"]>) {
  const used = [...new Set(meta.toolsUsed)];
  const done = used.map((t) => ACTIONS[t]?.done).filter(Boolean) as string[];
  const read = used.map((t) => READ_LABEL[t]).filter(Boolean) as string[];
  const recalled = meta.memoriesUsed + meta.examplesUsed;
  const parts = [...done, ...(read.length ? [`a consulté ${frenchList(read)}`] : [])];
  let line = `L'agent ${agentName} ${parts.length ? frenchList(parts) : "a répondu"}`;
  if (recalled) line += `, en s'appuyant sur ${recalled} souvenir${recalled > 1 ? "s" : ""}`;
  return line;
}

function actionLinks(meta: NonNullable<Message["meta"]>) {
  const seen = new Map<string, string>();
  for (const t of meta.toolsUsed) {
    const a = ACTIONS[t];
    if (a && t !== "memoriser") seen.set(a.href, a.link);
  }
  return [...seen.entries()];
}

export function Chat({
  agents,
  initialConversationId,
  initialMessages = [],
  initialDeletions = [],
}: {
  agents: AgentOption[];
  initialConversationId?: string;
  initialMessages?: Pick<Message, "role" | "content" | "agent" | "runId">[];
  initialDeletions?: DeletionRequest[];
}) {
  const router = useRouter();
  const [agent, setAgent] = useState("auto");
  const [conversationId, setConversationId] = useState(() => initialConversationId ?? crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [deletions, setDeletions] = useState<DeletionRequest[]>(initialDeletions);
  const bottom = useRef<HTMLDivElement>(null);
  const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  // Accolades obligatoires : scrollIntoView renvoie une promesse dans les navigateurs récents,
  // et React prendrait toute valeur renvoyée pour une fonction de nettoyage.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: message }]);
    setPending(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, agent, conversationId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(
          data?.error ??
            (res.status === 504 ? "délai dépassé côté serveur, réessaie" : `le serveur a répondu ${res.status}`),
        );
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.text,
          agent: data.agent,
          runId: data.runId,
          meta: {
            routedBy: data.routedBy,
            memoriesUsed: data.memoriesUsed,
            examplesUsed: data.examplesUsed,
            toolsUsed: data.toolsUsed,
            provider: data.provider,
          },
        },
      ]);
      setDeletions((current) => [...new Map([...current, ...(data.deletions ?? [])].map((d: DeletionRequest) => [d.id, d])).values()]);
      // Met à jour la liste des conversations à côté du chat.
      router.refresh();
    } catch (error) {
      setMessages((m) => [...m, { role: "assistant", content: `Erreur : ${error instanceof Error ? error.message : error}` }]);
    } finally {
      setPending(false);
    }
  }

  async function decideDeletion(deletion: DeletionRequest, decision: "confirm" | "cancel") {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/agents/deletions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: deletion.id, conversationId, decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "La confirmation a échoué.");
      setDeletions((current) => current.filter((d) => d.id !== deletion.id));
      setMessages((current) => [...current, { role: "assistant", content: data.message }]);
      router.refresh();
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", content: `Erreur : ${error instanceof Error ? error.message : error}` }]);
    } finally {
      setPending(false);
    }
  }

  async function feedback(index: number, rating: 1 | -1, correction: string | null = null) {
    const msg = messages[index];
    if (!msg.runId) return;
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: msg.runId, rating, correction }),
    });
    if (res.ok) setMessages((m) => m.map((x, i) => (i === index ? { ...x, rating } : x)));
  }

  return (
    <div className="card flex h-[calc(100dvh-16rem)] min-h-112 flex-col p-0">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-3" role="radiogroup" aria-label="Agent à qui parler">
        {[{ id: "auto", name: "Le bon agent", tagline: "Kaobase choisit selon ta question" }, ...agents].map((a) => (
          <button
            key={a.id}
            role="radio"
            aria-checked={agent === a.id}
            title={a.tagline}
            onClick={() => setAgent(a.id)}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${agent === a.id ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
          >
            {a.name}
          </button>
        ))}
        <button
          className="ml-auto text-xs text-ink-3 hover:text-ink"
          disabled={pending}
          onClick={() => {
            setMessages([]);
            setDeletions([]);
            setConversationId(crypto.randomUUID());
            router.push("/agents");
          }}
        >
          Nouvelle conversation
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mx-auto max-w-lg pt-6 text-center">
            <p className="font-display text-2xl">Que veux-tu savoir ?</p>
            <p className="mt-1 text-sm text-ink-2">Quelques idées pour commencer :</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-accent hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="reply ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-sm text-accent-ink">
              {m.content}
            </div>
          ) : (
            <AssistantMessage key={i} message={m} agentName={m.agent ? names[m.agent] : undefined} onFeedback={(r, c) => feedback(i, r, c)} />
          ),
        )}
        {pending && (
          <p className="flex items-center gap-2 text-sm text-ink-3" role="status">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
            Recherche dans tes données…
          </p>
        )}
        {deletions.length > 0 && (
          <section aria-label="Suppressions à confirmer" className="space-y-3 rounded-md border border-line p-3">
            <p className="text-sm font-medium">Vérifie chaque élément avant de confirmer sa suppression.</p>
            {deletions.map((deletion) => (
              <div key={deletion.id} className="space-y-2 text-sm">
                <p>{deletion.description}</p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-ghost btn-sm text-neg" disabled={pending} onClick={() => decideDeletion(deletion, "confirm")}>
                    Confirmer la suppression
                  </button>
                  <button className="btn-ghost btn-sm" disabled={pending} onClick={() => decideDeletion(deletion, "cancel")}>Annuler</button>
                </div>
              </div>
            ))}
          </section>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex. : combien me coûte Netflix par an ?"
          aria-label="Message"
        />
        <button className="btn-primary" disabled={pending || !input.trim()}>Envoyer</button>
      </form>
    </div>
  );
}

function AssistantMessage({
  message,
  agentName,
  onFeedback,
}: {
  message: Message;
  agentName?: string;
  onFeedback: (rating: 1 | -1, correction: string | null) => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState("");
  const meta = message.meta;

  return (
    <div className="reply max-w-[85%]">
      {agentName && meta && (
        <p className="mb-1 text-xs text-ink-3" title={meta.provider ? `Modèle : ${meta.provider}` : undefined}>
          {describe(agentName, meta)}
        </p>
      )}
      <div className="rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-2 text-sm">
        <Markdown text={message.content} />
      </div>
      {meta && actionLinks(meta).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {actionLinks(meta).map(([href, label]) => (
            <Link key={href} href={href} className="btn-ghost btn-sm">
              {label}
            </Link>
          ))}
        </div>
      )}
      {message.runId && (
        <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
          <button onClick={() => onFeedback(1, null)} className={message.rating === 1 ? "text-pos" : "hover:text-ink"} aria-label="Bonne réponse">
            👍
          </button>
          <button onClick={() => onFeedback(-1, null)} className={message.rating === -1 ? "text-neg" : "hover:text-ink"} aria-label="Mauvaise réponse">
            👎
          </button>
          <button onClick={() => setCorrecting((c) => !c)} className="hover:text-ink">Corriger la réponse</button>
          {message.rating === 1 && <span>Retenu comme bonne réponse.</span>}
          {message.rating === -1 && <span>Noté, l&apos;agent changera d&apos;approche.</span>}
        </div>
      )}
      {correcting && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!correction.trim()) return;
            onFeedback(-1, correction);
            setCorrecting(false);
          }}
        >
          <input className="input" value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="Ce que l'agent aurait dû répondre" aria-label="Correction" />
          <button className="btn-ghost btn-sm">Enregistrer la correction</button>
        </form>
      )}
    </div>
  );
}
