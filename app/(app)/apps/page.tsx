import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listAppShortcuts } from "@/lib/data/apps";
import { defaultSpace, getSpaceFilter } from "@/lib/space";
import type { AppShortcut } from "@/lib/apps";
import { AppEditor } from "./app-editor";
import { AppsList } from "./apps-list";
import { AppCatalog } from "./app-catalog";
import { getAppCatalog } from "@/lib/integrations/app-catalog";
import { listAppConnections, type AppConnection } from "@/lib/data/app-connections";

export const metadata: Metadata = { title: "Mes apps" };

export default async function AppsPage() {
  const { supabase } = await requireUser();
  const space = await getSpaceFilter();
  const catalogPromise = getAppCatalog();
  let apps: AppShortcut[] | null = null;
  let connections: AppConnection[] | null = null;
  try { apps = await listAppShortcuts(supabase, space); }
  catch (error) { console.error("[kaobase] chargement apps :", error); }
  try { connections = await listAppConnections(supabase); }
  catch { /* The shortcuts remain useful while an OAuth migration is pending. */ }
  const catalog = await catalogPromise;

  return (
    <div className="min-w-0 space-y-7">
      <header>
        <h1 className="page-title">Mes apps</h1>
        <p className="page-lede">Tes services et leurs comptes, au même endroit. Classe-les et garde les plus utiles à portée de main sur l&apos;accueil.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="#catalogue-apps" className="btn-primary btn-sm">Découvrir des apps</a>
          <a href="#ajouter-une-app" className="btn-ghost btn-sm">Ajouter un lien personnalisé</a>
        </div>
      </header>
      {apps ? (
        <>
          {!connections && <p className="card text-sm text-ink-2" role="status">Le statut des connexions est momentanément indisponible. Réessaie dans un instant. Tes raccourcis restent accessibles.</p>}
          <AppsList apps={apps} space={space} connections={connections ?? []} connectionsAvailable={connections !== null} />
        </>
      ) : (
        <div className="card space-y-3" role="alert">
          <h2 className="section-title">Tes apps sont momentanément indisponibles</h2>
          <p className="text-sm text-ink-2">Réessaie dans quelques instants.</p>
          <Link href="/apps" className="btn-ghost">Réessayer</Link>
        </div>
      )}
      <section id="catalogue-apps" className="scroll-mt-6"><AppCatalog key={space} catalog={catalog} space={space} /></section>
      {apps && <section id="ajouter-une-app" className="scroll-mt-6"><AppEditor key={space} defaultSpace={defaultSpace(space)} /></section>}
    </div>
  );
}
