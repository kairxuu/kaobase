"use client";

import { useEffect, useRef, useState } from "react";

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
  "Combien j'ai dépensé en restaurants ce mois-ci ?",
  "Quels abonnements pourrais-je résilier pour économiser ?",
  "Crée-moi des rappels pour les prélèvements de la semaine",
  "Est-ce que mes données importées sont propres ?",
];

export function Chat({ agents }: { agents: AgentOption[] }) {
  const [agent, setAgent] = useState("auto");
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages, pending]);

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
    } catch (error) {
      setMessages((m) => [...m, { role: "assistant", content: `Erreur : ${error instanceof Error ? error.message : error}` }]);
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
    <div className="card flex h-[calc(100vh-14rem)] min-h-[28rem] flex-col p-0">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-3">
        {[{ id: "auto", name: "Auto", tagline: "L'orchestrateur choisit l'agent" }, ...agents].map((a) => (
          <button
            key={a.id}
            title={a.tagline}
            onClick={() => setAgent(a.id)}
            className={`rounded-full px-3 py-1 text-sm ${agent === a.id ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2 hover:text-ink"}`}
          >
            {a.name}
          </button>
        ))}
        <button
          className="ml-auto text-xs text-ink-3 hover:text-ink"
          onClick={() => {
            setMessages([]);
            setConversationId(crypto.randomUUID());
          }}
        >
          Nouvelle conversation
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-lg border border-line p-3 text-left text-sm text-ink-2 hover:bg-surface-2">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-sm text-accent-ink">
              {m.content}
            </div>
          ) : (
            <AssistantMessage key={i} message={m} agentName={m.agent ? names[m.agent] : undefined} onFeedback={(r, c) => feedback(i, r, c)} />
          ),
        )}
        {pending && <p className="text-sm text-ink-3">L&apos;agent réfléchit…</p>}
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
          placeholder="Pose ta question…"
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
    <div className="max-w-[85%]">
      {agentName && (
        <p className="mb-1 text-xs text-ink-3">
          Agent <span className="font-medium text-ink-2">{agentName}</span>
          {meta && (
            <>
              {meta.routedBy !== "user" && ` · routé par ${meta.routedBy === "keywords" ? "mots-clés" : "IA"}`}
              {meta.memoriesUsed > 0 && ` · ${meta.memoriesUsed} souvenir(s)`}
              {meta.examplesUsed > 0 && ` · ${meta.examplesUsed} exemple(s) validé(s)`}
              {meta.toolsUsed.length > 0 && ` · outils : ${[...new Set(meta.toolsUsed)].join(", ")}`}
              {meta.provider && ` · ${meta.provider}`}
            </>
          )}
        </p>
      )}
      <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface-2 px-4 py-2 text-sm">{message.content}</div>
      {message.runId && (
        <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
          <button onClick={() => onFeedback(1, null)} className={message.rating === 1 ? "text-pos" : "hover:text-ink"} aria-label="Bonne réponse">
            👍
          </button>
          <button onClick={() => onFeedback(-1, null)} className={message.rating === -1 ? "text-neg" : "hover:text-ink"} aria-label="Mauvaise réponse">
            👎
          </button>
          <button onClick={() => setCorrecting((c) => !c)} className="hover:text-ink">Corriger</button>
          {message.rating && <span>merci, c&apos;est noté</span>}
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
          <input className="input" value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="La bonne réponse serait…" />
          <button className="btn-ghost btn-sm">Envoyer</button>
        </form>
      )}
    </div>
  );
}
