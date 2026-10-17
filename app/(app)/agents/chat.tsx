"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Modal } from "../_components/modal";
import { deleteConversationAction } from "../actions";
import type { ConversationSummary } from "@/lib/data/agents";
import {
  chatStorageKey,
  restoredMessages,
  type ChatSnapshot,
} from "@/lib/chat-storage";
import {
  readChatCache,
  writeChatCache,
  rememberConversation,
  browserClock,
  STORAGE_FAILURE,
  cachedConversations,
  CACHE_UPDATED,
} from "@/lib/chat-browser";
import { shortDate } from "@/lib/ui/format";
import { Markdown } from "./markdown";
import type { DeletionRequest } from "@/lib/agents/confirmation";

type AgentOption = { id: string; name: string; tagline: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  agent?: string;
  runId?: string | null;
  meta?: {
    routedBy: string;
    memoriesUsed: number;
    examplesUsed: number;
    toolsUsed: string[];
    provider: string | null;
  };
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
  ajouter_operations: {
    done: "a enregistré des opérations",
    href: "/transactions",
    link: "Voir les opérations",
  },
  modifier_operation: {
    done: "a corrigé une opération",
    href: "/transactions",
    link: "Voir les opérations",
  },
  supprimer_operation: {
    done: "a supprimé une opération",
    href: "/transactions",
    link: "Voir les opérations",
  },
  categoriser_operation: {
    done: "a changé une catégorie",
    href: "/transactions",
    link: "Voir les opérations",
  },
  categoriser_non_classees: {
    done: "a trié des opérations",
    href: "/transactions",
    link: "Voir les opérations",
  },
  creer_categorie: {
    done: "a créé une catégorie",
    href: "/settings",
    link: "Voir les réglages",
  },
  creer_compte: {
    done: "a ajouté un compte",
    href: "/settings",
    link: "Voir les réglages",
  },
  definir_budget: {
    done: "a fixé un budget",
    href: "/",
    link: "Voir la vue d'ensemble",
  },
  supprimer_budget: {
    done: "a retiré un budget",
    href: "/",
    link: "Voir la vue d'ensemble",
  },
  creer_abonnement: {
    done: "a ajouté un abonnement",
    href: "/subscriptions",
    link: "Voir les abonnements",
  },
  modifier_abonnement: {
    done: "a mis à jour un abonnement",
    href: "/subscriptions",
    link: "Voir les abonnements",
  },
  creer_taches: {
    done: "a créé des tâches",
    href: "/tasks",
    link: "Voir les tâches",
  },
  modifier_tache: {
    done: "a mis à jour une tâche",
    href: "/tasks",
    link: "Voir les tâches",
  },
  supprimer_tache: {
    done: "a supprimé une tâche",
    href: "/tasks",
    link: "Voir les tâches",
  },
  planifier_rappels_abonnements: {
    done: "a créé des rappels",
    href: "/tasks",
    link: "Voir les tâches",
  },
  memoriser: {
    done: "a retenu une information",
    href: "/agents/performance",
    link: "Voir ce qu'ils ont appris",
  },
};

function frenchList(items: string[]) {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`;
}

function describe(agentName: string, meta: NonNullable<Message["meta"]>) {
  const used = [...new Set(meta.toolsUsed)];
  const done = used.map((t) => ACTIONS[t]?.done).filter(Boolean) as string[];
  const read = used.map((t) => READ_LABEL[t]).filter(Boolean) as string[];
  const recalled = meta.memoriesUsed + meta.examplesUsed;
  const parts = [
    ...done,
    ...(read.length ? [`a consulté ${frenchList(read)}`] : []),
  ];
  let line = `L'agent ${agentName} ${parts.length ? frenchList(parts) : "a répondu"}`;
  if (recalled)
    line += `, en s'appuyant sur ${recalled} souvenir${recalled > 1 ? "s" : ""}`;
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

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_DELETIONS: DeletionRequest[] = [];

type ChatProps = {
  agents: AgentOption[];
  userId: string;
  conversations: ConversationSummary[];
  enabled?: boolean;
  initialConversationId: string;
  initialMessages?: Pick<Message, "role" | "content" | "agent" | "runId">[];
  initialDeletions?: DeletionRequest[];
};
const subscribeHydration = () => () => {};
export function Chat(props: ChatProps) {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  if (!hydrated)
    return (
      <div className="chat-shell" aria-busy="true">
        <p className="text-sm text-ink-2">Ouverture de la conversation…</p>
      </div>
    );
  return <ChatSession {...props} />;
}
function ChatSession({
  agents,
  userId,
  conversations,
  enabled = true,
  initialConversationId,
  initialMessages = EMPTY_MESSAGES,
  initialDeletions = EMPTY_DELETIONS,
}: ChatProps) {
  const router = useRouter();
  const conversationId = initialConversationId;
  const cacheKey = chatStorageKey(userId, conversationId);
  const [initialCache] = useState(() => readChatCache(cacheKey));
  const [agent, setAgent] = useState(() =>
    initialCache.value &&
    (initialCache.value.agent === "auto" ||
      agents.some((a) => a.id === initialCache.value?.agent))
      ? initialCache.value.agent
      : "auto",
  );
  const [messages, setMessages] = useState<Message[]>(() =>
    restoredMessages(initialMessages, initialCache.value?.messages ?? []),
  );
  const [input, setInput] = useState(() => initialCache.value?.input ?? "");
  const [pending, setPending] = useState(false);
  const [recovering, setRecovering] = useState(() =>
    Boolean(
      initialCache.value?.pendingSince &&
        browserClock() - initialCache.value.pendingSince < 90000 &&
        initialMessages.length < initialCache.value.messages.length,
    ),
  );
  const [deletions, setDeletions] = useState(initialDeletions);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [localHistory, setLocalHistory] = useState(() =>
    cachedConversations(userId),
  );
  const [historySearch, setHistorySearch] = useState("");
  const [remove, setRemove] = useState<ConversationSummary | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [confirmDeletion, setConfirmDeletion] =
    useState<DeletionRequest | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState(() =>
    initialCache.value?.pendingSince &&
    browserClock() - initialCache.value.pendingSince >= 90000
      ? "La dernière demande a été interrompue. Vérifie la conversation avant de renvoyer ton message."
      : "",
  );
  const [deletionError, setDeletionError] = useState("");
  const [storageWarning, setStorageWarning] = useState(!initialCache.available);
  const [openedAt] = useState(() => new Date().toISOString());
  const [serverVersion, setServerVersion] = useState({
    messages: initialMessages,
    deletions: initialDeletions,
  });
  if (
    serverVersion.messages !== initialMessages ||
    serverVersion.deletions !== initialDeletions
  ) {
    setServerVersion({
      messages: initialMessages,
      deletions: initialDeletions,
    });
    setMessages((current) => restoredMessages(initialMessages, current));
    setDeletions(initialDeletions);
    if (
      initialMessages.length >= messages.length &&
      initialMessages.at(-1)?.role === "assistant"
    )
      setRecovering(false);
  }
  const bottom = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const pendingAt = useRef<number | null>(null);
  const snapshot = useRef<ChatSnapshot>(
    initialCache.value ?? {
      messages: initialMessages,
      input: "",
      agent: "auto",
      pendingSince: null,
    },
  );
  const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));
  const busy = pending || recovering;

  function save(value: ChatSnapshot) {
    snapshot.current = value;
    writeChatCache(cacheKey, value);
  }
  function remember(id: string) {
    rememberConversation(userId, id);
  }

  useEffect(() => {
    rememberConversation(userId, conversationId);
  }, [userId, conversationId]);
  useEffect(() => {
    if (!historyOpen) return;
    const update = () => setLocalHistory(cachedConversations(userId));
    window.addEventListener(CACHE_UPDATED, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(CACHE_UPDATED, update);
      window.removeEventListener("storage", update);
    };
  }, [historyOpen, userId]);

  useEffect(() => {
    const unavailable = () => setStorageWarning(true);
    window.addEventListener(STORAGE_FAILURE, unavailable);
    return () => window.removeEventListener(STORAGE_FAILURE, unavailable);
  }, []);
  useEffect(() => {
    const value = {
      messages,
      input,
      agent,
      pendingSince: pending
        ? pendingAt.current
        : recovering
          ? snapshot.current.pendingSince
          : null,
    };
    snapshot.current = value;
    writeChatCache(cacheKey, value);
  }, [messages, input, agent, pending, recovering, cacheKey]);

  useEffect(() => {
    if (!recovering) return;
    const deadline = browserClock() + 90000;
    const interval = setInterval(() => {
      const stored = readChatCache(cacheKey).value;
      if (stored && !stored.pendingSince) {
        setMessages(stored.messages);
        setRecovering(false);
        router.refresh();
        return;
      }
      if (browserClock() > deadline) {
        setRecovering(false);
        setRecoveryNotice(
          "La réponse n’est pas encore disponible. Vérifie l’historique avant de réessayer.",
        );
        return;
      }
      router.refresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [recovering, router, cacheKey]);

  useEffect(() => {
    const area = scrollArea.current;
    if (area) area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
  }, [messages, pending, recovering]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || !enabled) return;
    const sent: Message[] = [...messages, { role: "user", content: message }];
    pendingAt.current = browserClock();
    setInput("");
    setMessages(sent);
    setPending(true);
    setRecoveryNotice("");
    remember(conversationId);
    save({ messages: sent, input: "", agent, pendingSince: pendingAt.current });
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, agent, conversationId }),
        keepalive: true,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data)
        throw new Error(
          data?.error ??
            (res.status === 401
              ? "Ta session a expiré. Reconnecte-toi."
              : "La réponse n’a pas pu être chargée."),
        );
      const completed: Message[] = [
        ...sent,
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
      ];
      setMessages(completed);
      save({ ...snapshot.current, messages: completed, pendingSince: null });
      setDeletions((current) => [
        ...new Map(
          [...current, ...(data.deletions ?? [])].map((d: DeletionRequest) => [
            d.id,
            d,
          ]),
        ).values(),
      ]);
      router.refresh();
    } catch (error) {
      const completed: Message[] = [
        ...sent,
        {
          role: "assistant",
          content: `Erreur : ${error instanceof Error ? error.message : "Connexion interrompue."}`,
        },
      ];
      setMessages(completed);
      save({ ...snapshot.current, messages: completed, pendingSince: null });
    } finally {
      setPending(false);
      pendingAt.current = null;
    }
  }

  async function decideDeletion(
    deletion: DeletionRequest,
    decision: "confirm" | "cancel",
  ) {
    if (busy) return;
    setPending(true);
    setDeletionError("");
    try {
      const res = await fetch("/api/agents/deletions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: deletion.id,
          conversationId,
          decision,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "La confirmation a échoué.");
      setDeletions((current) => current.filter((d) => d.id !== deletion.id));
      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.message },
      ]);
      setConfirmDeletion(null);
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Suppression impossible.";
      if (decision === "confirm") setDeletionError(message);
      else
        setMessages((current) => [
          ...current,
          { role: "assistant", content: `Erreur : ${message}` },
        ]);
    } finally {
      setPending(false);
    }
  }
  async function feedback(
    index: number,
    rating: 1 | -1,
    correction: string | null = null,
  ) {
    const msg = messages[index];
    if (!msg.runId) return;
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: msg.runId, rating, correction }),
    });
    if (res.ok)
      setMessages((current) =>
        current.map((m, i) => (i === index ? { ...m, rating } : m)),
      );
  }
  function newConversation() {
    const id = crypto.randomUUID();
    remember(id);
    router.push(`/agents?c=${id}`);
  }
  async function removeConversation() {
    if (!remove) return;
    setRemoveBusy(true);
    setRemoveError("");
    try {
      const result = await deleteConversationAction(remove.id);
      if (!result.ok) throw new Error(result.error);
      try {
        localStorage.removeItem(chatStorageKey(userId, remove.id));
      } catch {}
      setRemovedIds((ids) => [...ids, remove.id]);
      const active = remove.id === conversationId;
      setRemove(null);
      if (active) {
        setMessages([]);
        setInput("");
        newConversation();
      } else router.refresh();
    } catch (error) {
      setRemoveError(
        error instanceof Error ? error.message : "Suppression impossible.",
      );
    } finally {
      setRemoveBusy(false);
    }
  }
  const pendingHistoryIds = new Set(
    localHistory.filter((c) => c.pending).map((c) => c.id),
  );
  const currentTitle = messages
    .find((m) => m.role === "user")
    ?.content.slice(0, 80);
  const historyCandidates = [
    ...(currentTitle && !conversations.some((c) => c.id === conversationId)
      ? [
          {
            id: conversationId,
            title: currentTitle,
            agent,
            lastAt: openedAt,
            messages: messages.filter((m) => m.role === "user").length,
          },
        ]
      : []),
    ...conversations,
    ...localHistory.filter(
      (c) => !conversations.some((server) => server.id === c.id),
    ),
  ];
  const history = [
    ...new Map(historyCandidates.map((c) => [c.id, c])).values(),
  ].filter(
    (c) =>
      !removedIds.includes(c.id) &&
      c.title
        .toLocaleLowerCase("fr")
        .includes(historySearch.toLocaleLowerCase("fr")),
  );

  return (
    <div className="chat-shell">
      <header className="chat-toolbar">
        <h1>Assistant IA</h1>
        <div className="chat-toolbar-actions">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              setLocalHistory(cachedConversations(userId));
              setHistoryOpen(true);
            }}
          >
            Historique
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={busy}
            onClick={newConversation}
          >
            Nouvelle conversation
          </button>
        </div>
      </header>
      <div
        className="chat-messages"
        ref={scrollArea}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p className="text-xs text-accent">Kaobase · ton assistant</p>
            <h2>Que souhaites-tu vérifier ?</h2>
            <p className="text-sm text-ink-2">
              Une question sur tes comptes, tes abonnements ou tes dépenses.
            </p>
            <div className="chat-prompts">
              {SUGGESTIONS.slice(1, 4).map((s) => (
                <button
                  key={s}
                  disabled={busy || !enabled}
                  onClick={() => void send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-message-list">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div className="chat-user" key={i}>
                  {m.content}
                </div>
              ) : (
                <AssistantMessage
                  key={i}
                  message={m}
                  agentName={m.agent ? names[m.agent] : undefined}
                  onFeedback={(r, c) => void feedback(i, r, c)}
                />
              ),
            )}
            {busy && (
              <p className="text-sm text-ink-2" role="status">
                {recovering
                  ? "Récupération de la réponse en cours…"
                  : "Analyse de tes données…"}
              </p>
            )}
            {deletions.length > 0 && (
              <section
                className="card space-y-4"
                aria-label="Suppressions à confirmer"
              >
                {deletions.map((d) => (
                  <div key={d.id}>
                    <p className="mb-3 text-sm">{d.description}</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn-ghost btn-sm text-neg"
                        disabled={busy}
                        onClick={() => {
                          setDeletionError("");
                          setConfirmDeletion(d);
                        }}
                      >
                        Confirmer la suppression
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => void decideDeletion(d, "cancel")}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>
      {storageWarning && (
        <p className="mb-3 text-xs text-warn" role="status">
          Le stockage local est indisponible : le brouillon ne pourra pas être
          conservé après fermeture. Les échanges envoyés restent dans
          l’historique du compte.
        </p>
      )}
      {recoveryNotice && (
        <p className="mb-3 text-sm text-warn" role="status">
          {recoveryNotice}
        </p>
      )}
      {!enabled && (
        <p className="mb-3 text-sm text-warn" role="status">
          L’assistant est momentanément indisponible. Tes conversations restent
          accessibles.
        </p>
      )}
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          aria-label="Message"
          placeholder="Pose ta question…"
          value={input}
          maxLength={4000}
          onChange={(e) => {
            setInput(e.target.value);
            save({ ...snapshot.current, input: e.target.value });
          }}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="chat-composer-footer">
          <select
            className="input"
            aria-label="Agent à qui parler"
            value={agent}
            disabled={busy}
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="auto">Choix automatique</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            className="btn-primary"
            disabled={busy || !input.trim() || !enabled}
          >
            Envoyer <span aria-hidden>↑</span>
          </button>
        </div>
      </form>
      <p className="chat-note">
        Vérifie les montants et les actions proposés. Maj + Entrée pour aller à
        la ligne.
      </p>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Historique des conversations"
      >
        <label className="label" htmlFor="conversation-search">
          Rechercher une conversation
        </label>
        <input
          className="input"
          id="conversation-search"
          type="search"
          value={historySearch}
          onChange={(e) => setHistorySearch(e.target.value)}
          placeholder="Un sujet, une question…"
        />
        {history.length ? (
          <ul className="chat-history-list">
            {history.map((c) => (
              <li
                key={c.id}
                className="chat-history-item"
                aria-current={c.id === conversationId ? "true" : undefined}
              >
                <Link
                  href={`/agents?c=${c.id}`}
                  onClick={() => {
                    remember(c.id);
                    setHistoryOpen(false);
                  }}
                >
                  <span className="block break-words text-sm font-medium">
                    {c.title}
                  </span>
                  <span className="text-xs text-ink-2">
                    {shortDate(c.lastAt)} · {names[c.agent] ?? "Assistant"}
                    {c.id === conversationId ? " · en cours" : ""}
                  </span>
                </Link>
                <button
                  type="button"
                  className="btn-ghost btn-sm text-neg"
                  disabled={busy || pendingHistoryIds.has(c.id)}
                  onClick={() => {
                    setRemove(c);
                    setRemoveError("");
                  }}
                  aria-label={`Supprimer la conversation ${c.title}`}
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 text-sm text-ink-2">
            {historySearch
              ? "Aucune conversation trouvée."
              : "Tes conversations apparaîtront ici."}
          </p>
        )}
      </Modal>
      <Modal
        open={Boolean(remove)}
        onClose={() => setRemove(null)}
        title="Supprimer cette conversation ?"
        busy={removeBusy}
      >
        <p className="text-sm text-ink-2">
          « {remove?.title} » sera supprimée de l’historique. Les souvenirs déjà
          retenus par les agents restent conservés.
        </p>
        {removeError && (
          <p role="alert" className="mt-3 text-sm text-neg">
            {removeError}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            className="btn-ghost"
            disabled={removeBusy}
            onClick={() => setRemove(null)}
          >
            Annuler
          </button>
          <button
            className="btn-primary"
            disabled={removeBusy}
            onClick={() => void removeConversation()}
          >
            {removeBusy ? "Suppression…" : "Supprimer la conversation"}
          </button>
        </div>
      </Modal>
      <Modal
        open={Boolean(confirmDeletion)}
        onClose={() => setConfirmDeletion(null)}
        title="Confirmer la suppression"
        busy={pending}
      >
        <p className="text-sm">{confirmDeletion?.description}</p>
        {deletionError && (
          <p role="alert" className="mt-3 text-sm text-neg">
            {deletionError}
          </p>
        )}
        <p className="mt-2 text-sm text-ink-2">
          Cette action supprimera les données indiquées.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="btn-ghost"
            disabled={pending}
            onClick={() => setConfirmDeletion(null)}
          >
            Retour
          </button>
          <button
            className="btn-primary"
            disabled={pending}
            onClick={() =>
              confirmDeletion && void decideDeletion(confirmDeletion, "confirm")
            }
          >
            Supprimer
          </button>
        </div>
      </Modal>
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
    <div className="chat-assistant">
      {agentName && meta && (
        <p
          className="mb-1 text-xs text-ink-3"
          title={meta.provider ? `Modèle : ${meta.provider}` : undefined}
        >
          {describe(agentName, meta)}
        </p>
      )}
      <div className="chat-answer">
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
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-2">
          <button
            onClick={() => onFeedback(1, null)}
            className={message.rating === 1 ? "text-pos" : "hover:text-ink"}
            aria-label="Bonne réponse"
          >
            👍
          </button>
          <button
            onClick={() => onFeedback(-1, null)}
            className={message.rating === -1 ? "text-neg" : "hover:text-ink"}
            aria-label="Mauvaise réponse"
          >
            👎
          </button>
          <button
            onClick={() => setCorrecting((c) => !c)}
            className="hover:text-ink"
          >
            Corriger la réponse
          </button>
          {message.rating === 1 && <span>Retenu comme bonne réponse.</span>}
          {message.rating === -1 && (
            <span>Noté, l&apos;agent changera d&apos;approche.</span>
          )}
        </div>
      )}
      {correcting && (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!correction.trim()) return;
            onFeedback(-1, correction);
            setCorrecting(false);
          }}
        >
          <input
            className="input"
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            placeholder="Ce que l'agent aurait dû répondre"
            aria-label="Correction"
          />
          <button className="btn-ghost btn-sm">
            Enregistrer la correction
          </button>
        </form>
      )}
    </div>
  );
}
