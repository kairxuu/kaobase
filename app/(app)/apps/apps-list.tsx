"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_CATEGORIES, type AppShortcut } from "@/lib/apps";
import type { AppConnection } from "@/lib/data/app-connections";
import { SPACE_LABEL, type SpaceFilter } from "@/lib/space-shared";
import { ActionButton } from "../_components/action-button";
import { AppAvatar } from "../_components/app-avatar";
import { AppEditor } from "./app-editor";
import { deleteAppAction, pinAppAction } from "./actions";

function hostname(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

function searchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}

function DisconnectButton({ app, connection }: { app: AppShortcut; connection: AppConnection }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (!window.confirm(`Retirer l’autorisation de ${app.name} dans Kaobase ? Le raccourci et ton compte sur ce service seront conservés.`)) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/apps/connections/${encodeURIComponent(connection.id)}/disconnect`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        throw new Error(result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "La déconnexion a échoué. Réessaie dans un instant.");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La déconnexion a échoué. Réessaie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-w-0">
      <button type="button" className="btn-ghost btn-sm text-neg" disabled={pending} onClick={() => void disconnect()}>{pending ? "Déconnexion…" : "Déconnecter le compte"}</button>
      {error && <p className="mt-2 text-xs text-neg" role="alert">{error}</p>}
    </div>
  );
}

export function AppsList({ apps, space, connections = [], connectionsAvailable = true }: { apps: AppShortcut[]; space: SpaceFilter; connections?: AppConnection[]; connectionsAvailable?: boolean }) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("name-asc");
  const connectionByShortcut = useMemo(() => new Map(connections.map((connection) => [connection.shortcut_id, connection])), [connections]);
  const inSpace = apps.filter((app) => space === "all" || app.space === space);
  const query = searchText(search.trim());
  const visible = inSpace.filter((app) => (
    (category === "all" || app.category === category)
    && (!connectionsAvailable || status === "all" || (status === "connected" ? connectionByShortcut.has(app.id) : !connectionByShortcut.has(app.id)))
    && (!query || searchText(`${app.name} ${app.account_label ?? ""} ${hostname(app.url)} ${connectionByShortcut.get(app.id)?.provider_name ?? ""}`).includes(query))
  )).sort((left, right) => {
    const byName = left.name.localeCompare(right.name, "fr", { sensitivity: "base" }) || left.account_label.localeCompare(right.account_label, "fr");
    if (sort === "recent") return Date.parse(right.created_at) - Date.parse(left.created_at) || byName;
    if (sort === "pinned") return Number(right.pinned) - Number(left.pinned) || byName;
    if (sort === "category") return (APP_CATEGORIES.findIndex((item) => item.id === left.category) - APP_CATEGORIES.findIndex((item) => item.id === right.category)) || byName;
    return byName * (sort === "name-desc" ? -1 : 1);
  });

  if (inSpace.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-line px-5 py-10 text-center">
        <h2 className="text-sm font-medium">Aucune app {space === "all" ? "enregistrée" : `dans l’espace ${SPACE_LABEL[space].toLowerCase()}`}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">Choisis un service dans le catalogue ou ajoute ton propre lien. Épingle-le pour le retrouver sur l’accueil.</p>
      </div>
    );
  }

  return (
    <section className="min-w-0 space-y-4" aria-labelledby={`${id}-title`}>
      <h2 className="section-title" id={`${id}-title`}>Mes apps enregistrées</h2>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <label className="label" htmlFor={`${id}-search`}>Rechercher mes apps</label>
          <input className="input" id={`${id}-search`} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom, identifiant ou site…" />
        </div>
        <div className="min-w-0">
          <label className="label" htmlFor={`${id}-category`}>Catégorie</label>
          <select className="input" id={`${id}-category`} value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">Toutes les catégories</option>
            {APP_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className="label" htmlFor={`${id}-status`}>Type de compte</label>
          <select className="input" id={`${id}-status`} value={connectionsAvailable ? status : "all"} disabled={!connectionsAvailable} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Tous les comptes</option>
            <option value="connected">Autorisation enregistrée</option>
            <option value="link">Raccourcis simples</option>
          </select>
        </div>
        <div className="min-w-0">
          <label className="label" htmlFor={`${id}-sort`}>Trier par</label>
          <select className="input" id={`${id}-sort`} value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="name-asc">Nom : A → Z</option>
            <option value="name-desc">Nom : Z → A</option>
            <option value="recent">Ajout récent</option>
            <option value="pinned">Sur l’accueil d’abord</option>
            <option value="category">Catégorie</option>
          </select>
        </div>
      </div>

      <p className="text-xs text-ink-3" role="status">{visible.length} app{visible.length > 1 ? "s" : ""}{search || category !== "all" || status !== "all" ? " trouvée" : " enregistrée"}{visible.length > 1 ? "s" : ""}</p>
      {visible.length === 0 && (
        <div className="rounded-md border border-dashed border-line px-5 py-8 text-center">
          <p className="text-sm text-ink-2">Aucune app ne correspond à ta recherche.</p>
          <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => { setSearch(""); setCategory("all"); setStatus("all"); }}>Effacer les filtres</button>
        </div>
      )}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        {visible.map((app) => {
          const connection = connectionByShortcut.get(app.id);
          return (
            <article className="card min-w-0 space-y-4" key={app.id}>
              <div className="flex min-w-0 items-start gap-3">
                <AppAvatar name={app.name} category={app.category} />
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-sm font-semibold">{app.name}</h3>
                  <p className="mt-0.5 break-all text-xs text-ink-3">{hostname(app.url)}</p>
                </div>
                <a href={app.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="btn-ghost btn-sm shrink-0" aria-label={`Ouvrir ${app.name} dans un nouvel onglet`}>
                  Ouvrir <span aria-hidden="true">↗</span>
                </a>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-ink-3">Compte</p>
                <p className={`mt-0.5 break-all text-sm ${app.account_label ? "text-ink-2" : "text-ink-3"}`}>{app.account_label || "Aucun nom de compte renseigné"}</p>
                {connection && <p className="mt-1 break-words text-xs text-ink-3">Autorisation pour {connection.provider_name}. Le site peut demander une reconnexion.</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="badge">{APP_CATEGORIES.find((item) => item.id === app.category)?.label}</span>
                  <span className={`badge ${connection && connectionsAvailable ? "bg-pos/10 text-pos" : ""}`}>{!connectionsAvailable ? "Statut indisponible" : connection ? "Autorisation enregistrée" : "Raccourci simple"}</span>
                  {space === "all" && <span className="badge">{SPACE_LABEL[app.space]}</span>}
                  {app.pinned && <span className="badge bg-accent-soft text-accent">Sur l’accueil</span>}
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-start gap-2">
                <AppEditor app={app} />
                <ActionButton action={pinAppAction.bind(null, app.id, !app.pinned)}>
                  {app.pinned ? "Retirer de l’accueil" : "Afficher sur l’accueil"}
                </ActionButton>
                {connectionsAvailable && (connection ? (
                  <DisconnectButton app={app} connection={connection} />
                ) : (
                  <ActionButton action={deleteAppAction.bind(null, app.id)} className="btn-ghost btn-sm text-neg" confirm={`Supprimer le raccourci ${app.name}${app.account_label ? ` (${app.account_label})` : ""} ? Ton compte sur ce service sera conservé.`}>Supprimer</ActionButton>
                ))}
              </div>
              {connection && connectionsAvailable && <p className="text-xs text-ink-3">Déconnecte le compte avant de supprimer son raccourci.</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
