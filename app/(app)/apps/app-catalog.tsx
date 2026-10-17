"use client";

import { useId, useMemo, useState } from "react";
import type { CatalogResult } from "@/lib/app-catalog";
import { APP_CATEGORIES } from "@/lib/apps";
import { type SpaceFilter } from "@/lib/space-shared";
import { AppAvatar } from "../_components/app-avatar";
import { AppEditor } from "./app-editor";
import { ConnectAppButton } from "./connect-app-button";

const PAGE_SIZE = 8;
const categoryLabels = Object.fromEntries(APP_CATEGORIES.map((category) => [category.id, category.label]));

function searchable(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}

export function AppCatalog({ catalog, space }: { catalog: CatalogResult; space: SpaceFilter }) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("name-asc");
  const [connectableOnly, setConnectableOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const defaultSpace = space === "pro" ? "pro" : "perso";
  const query = searchable(search.trim());
  const filtered = useMemo(() => catalog.apps.filter((app) => (
    (category === "all" || app.category === category)
    && (!connectableOnly || app.integrations.length > 0)
    && (!query || searchable(`${app.name} ${app.id} ${app.description} ${categoryLabels[app.category]}`).includes(query))
  )).sort((left, right) => {
    if (sort === "connectable") return Number(right.integrations.length > 0) - Number(left.integrations.length > 0) || left.name.localeCompare(right.name, "fr", { sensitivity: "base" });
    if (sort === "category") return categoryLabels[left.category].localeCompare(categoryLabels[right.category], "fr") || left.name.localeCompare(right.name, "fr", { sensitivity: "base" });
    return left.name.localeCompare(right.name, "fr", { sensitivity: "base" }) * (sort === "name-desc" ? -1 : 1);
  }), [catalog.apps, category, connectableOnly, query, sort]);

  function clearFilters() {
    setSearch(""); setCategory("all"); setConnectableOnly(false); setLimit(PAGE_SIZE);
  }

  return (
    <section className="min-w-0 space-y-4" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title mb-1" id={`${id}-title`}>Découvrir des apps</h2>
          <p className="max-w-2xl text-sm text-ink-2">Cherche un service, ajoute son raccourci ou connecte un compte quand l’autorisation est disponible.</p>
        </div>
        <span className="badge shrink-0">{catalog.source === "nango" ? "Catalogue Nango" : "Sélection de départ"}</span>
      </div>
      {catalog.warning && <p className="rounded-md border border-line bg-surface-2 p-3 text-sm text-ink-2" role="status">{catalog.warning}</p>}
      {!catalog.configured && !catalog.warning && <p className="rounded-md border border-line bg-surface-2 p-3 text-sm text-ink-2">Les connexions de comptes seront disponibles après l’activation du service de connexion. Tu peux déjà enregistrer des raccourcis.</p>}
      <div className="card min-w-0 space-y-3">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <label className="label" htmlFor={`${id}-search`}>Rechercher dans le catalogue</label>
            <input className="input" id={`${id}-search`} type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} placeholder="Nom d’app ou service…" />
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor={`${id}-category`}>Catégorie</label>
            <select className="input" id={`${id}-category`} value={category} onChange={(event) => { setCategory(event.target.value); setLimit(PAGE_SIZE); }}>
              <option value="all">Toutes les catégories</option>
              {APP_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          <div className="min-w-0">
            <label className="label" htmlFor={`${id}-sort`}>Trier par</label>
            <select className="input" id={`${id}-sort`} value={sort} onChange={(event) => { setSort(event.target.value); setLimit(PAGE_SIZE); }}>
              <option value="name-asc">Nom : A → Z</option>
              <option value="name-desc">Nom : Z → A</option>
              <option value="connectable">Connexion disponible</option>
              <option value="category">Catégorie</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <label className="flex items-center gap-2 text-sm text-ink-2" htmlFor={`${id}-connectable`}>
            <input className="h-4 w-4 shrink-0 accent-accent" id={`${id}-connectable`} type="checkbox" checked={connectableOnly} onChange={(event) => { setConnectableOnly(event.target.checked); setLimit(PAGE_SIZE); }} />
            Connexion disponible uniquement
          </label>
          <p className="text-xs text-ink-3" role="status">{filtered.length} app{filtered.length > 1 ? "s" : ""} {query || category !== "all" || connectableOnly ? "trouvée" : "proposée"}{filtered.length > 1 ? "s" : ""}</p>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-5 py-8 text-center">
          <p className="text-sm text-ink-2">Aucune app ne correspond à ces filtres.</p>
          <button type="button" className="btn-ghost btn-sm mt-3" onClick={clearFilters}>Effacer les filtres</button>
        </div>
      ) : (
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
          {filtered.slice(0, limit).map((app) => {
            const connectable = app.integrations.length > 0;
            const oauth = app.authMode === "OAUTH1" || app.authMode === "OAUTH2";
            return (
              <article className="card min-w-0 space-y-4" key={app.id}>
                <div className="flex min-w-0 items-start gap-3">
                  <AppAvatar name={app.name} category={app.category} />
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-sm font-semibold">{app.name}</h3>
                    <p className="mt-0.5 text-xs text-ink-3">{categoryLabels[app.category]}</p>
                  </div>
                </div>
                {app.description && <p className="break-words text-sm text-ink-2">{app.description}</p>}
                <p><span className={`badge ${connectable ? "bg-pos/10 text-pos" : ""}`}>{connectable ? "Connexion OAuth disponible" : oauth ? "Connexion à configurer" : "Raccourci disponible"}</span></p>
                <div className="space-y-3">
                  {connectable && <ConnectAppButton app={app} defaultSpace={defaultSpace} />}
                  <AppEditor preset={{ name: app.name, url: app.url, category: app.category }} defaultSpace={defaultSpace} />
                </div>
              </article>
            );
          })}
        </div>
      )}
      {filtered.length > limit && <div className="text-center"><button type="button" className="btn-ghost" onClick={() => setLimit((current) => current + PAGE_SIZE)}>Afficher plus d’apps <span className="text-ink-3">({Math.min(limit, filtered.length)}/{filtered.length})</span></button></div>}
      <p className="text-xs text-ink-3">Le catalogue dépend des services pris en charge. Une connexion autorise l’accès prévu par le service et ne garantit pas une ouverture du site sans reconnexion.</p>
    </section>
  );
}
