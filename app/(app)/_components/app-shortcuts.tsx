import Link from "next/link";
import type { AppShortcut } from "@/lib/apps";
import { appHost } from "@/lib/apps";
import { AppAvatar } from "./app-avatar";

export function AppShortcuts({ apps, showSpace = false }: { apps: AppShortcut[] | null; showSpace?: boolean }) {
  return (
    <section aria-labelledby="app-shortcuts-title" className="card min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="app-shortcuts-title" className="text-sm font-semibold">Mes apps</h2>
          <p className="mt-1 text-xs text-ink-3">Accès rapides aux comptes épinglés.</p>
        </div>
        <Link href="/apps" className="btn-ghost btn-sm">Gérer mes apps</Link>
      </div>
      {apps === null ? (
        <p className="text-sm text-ink-2" role="status">Tes raccourcis sont momentanément indisponibles.</p>
      ) : apps.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-sm text-ink-2">Ajoute tes apps et épingle tes comptes favoris ici.</p>
          <Link href="/apps#ajouter-une-app" className="btn-ghost btn-sm">Ajouter une app</Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 xl:grid-cols-4">
          {apps.map((app) => (
            <li key={app.id} className="min-w-0">
              <a href={app.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                aria-label={`Ouvrir ${app.name}${app.account_label ? ` — ${app.account_label}` : ""} (nouvel onglet)`}
                className="flex min-w-0 items-center gap-3 rounded-[3px] border border-line px-3 py-3 transition-colors hover:border-accent hover:bg-accent-soft"
                title={`${app.name} · ${app.account_label || appHost(app.url)}`}>
                <AppAvatar url={app.url} name={app.name} category={app.category} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{app.name}</span>
                  <span className="block truncate text-xs text-ink-2">{app.account_label || appHost(app.url)}</span>
                  {showSpace && <span className="text-[10px] text-ink-3">{app.space === "pro" ? "Professionnel" : "Personnel"}</span>}
                </span>
                <span className="shrink-0 text-sm text-ink-3" aria-hidden>↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
