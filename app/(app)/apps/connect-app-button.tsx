"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ConnectUI } from "@nangohq/frontend";
import type { CatalogApp } from "@/lib/app-catalog";
import { APP_CATEGORIES, type AppCategory } from "@/lib/apps";
import type { Space } from "@/lib/space-shared";

type ConnectionDetails = {
  providerId: string;
  integrationId: string;
  name: string;
  url: string;
  accountLabel: string;
  category: AppCategory;
  space: Space;
  pinned: boolean;
};
type AuthorizedConnection = { details: ConnectionDetails; connectionId: string };

async function postJson(path: string, body: object): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error : "La connexion n’a pas pu être enregistrée. Réessaie dans un instant.";
    throw new Error(error);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Réponse de connexion inattendue. Réessaie dans un instant.");
  return result as Record<string, unknown>;
}

export function ConnectAppButton({ app, defaultSpace }: { app: CatalogApp; defaultSpace: Space }) {
  const id = useId();
  const router = useRouter();
  const ui = useRef<ConnectUI | null>(null);
  const mounted = useRef(true);
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<"starting" | "authorizing" | "saving" | null>(null);
  const [authorized, setAuthorized] = useState<AuthorizedConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ui.current?.close(); };
  }, []);

  async function saveConnection(connection: AuthorizedConnection) {
    setPhase("saving");
    setError(null);
    try {
      await postJson("/api/apps/connect/complete", { ...connection.details, connectionId: connection.connectionId });
      if (!mounted.current) return;
      setAuthorized(null);
      setExpanded(false);
      setSuccess(true);
      router.refresh();
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "L’enregistrement a échoué. Réessaie.");
    } finally {
      if (mounted.current) setPhase(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase) return;
    const form = new FormData(event.currentTarget);
    const details: ConnectionDetails = {
      providerId: authorized?.details.providerId ?? app.id,
      integrationId: authorized?.details.integrationId ?? String(form.get("integrationId") ?? ""),
      name: String(form.get("name") ?? ""),
      url: String(form.get("url") ?? ""),
      accountLabel: String(form.get("accountLabel") ?? ""),
      category: String(form.get("category") ?? app.category) as AppCategory,
      space: String(form.get("space") ?? defaultSpace) as Space,
      pinned: form.get("pinned") === "on",
    };
    if (authorized) {
      const connection = { details, connectionId: authorized.connectionId };
      setAuthorized(connection);
      await saveConnection(connection);
      return;
    }
    setError(null);
    setSuccess(false);
    setPhase("starting");
    try {
      const [{ default: Nango }, session] = await Promise.all([
        import("@nangohq/frontend"),
        postJson("/api/apps/connect/session", details),
      ]);
      if (!mounted.current) return;
      if (typeof session.token !== "string" || !session.token) throw new Error("La session de connexion est indisponible. Réessaie.");
      let completed = false;
      setPhase("authorizing");
      const nango = new Nango({ connectSessionToken: session.token });
      ui.current = nango.openConnectUI({
        lang: "fr",
        onEvent: async (nangoEvent) => {
          if (!mounted.current || completed) return;
          if (nangoEvent.type === "connect") {
            completed = true;
            ui.current?.close();
            ui.current = null;
            if (!nangoEvent.payload || nangoEvent.payload.providerConfigKey !== details.integrationId || typeof nangoEvent.payload.connectionId !== "string" || !nangoEvent.payload.connectionId) {
              setError("Le service connecté ne correspond pas à l’app choisie. Réessaie.");
              setPhase(null);
              return;
            }
            const connection = { details, connectionId: nangoEvent.payload.connectionId };
            setAuthorized(connection);
            await saveConnection(connection);
          } else if (nangoEvent.type === "close" || nangoEvent.type === "error") {
            completed = true;
            ui.current?.close();
            ui.current = null;
            setPhase(null);
            setError(nangoEvent.type === "close" ? "Connexion annulée. Tu peux réessayer quand tu veux." : "Le service n’a pas pu autoriser la connexion. Vérifie ton compte puis réessaie.");
          }
        },
      });
    } catch (cause) {
      if (!mounted.current) return;
      setPhase(null);
      setError(cause instanceof Error ? cause.message : "Le service de connexion est indisponible. Réessaie.");
    }
  }

  return (
    <div className="min-w-0">
      {!expanded && <button type="button" className="btn-primary btn-sm" aria-expanded={false} aria-controls={`${id}-form`} onClick={() => { setExpanded(true); setSuccess(false); setError(null); }}>Connecter un compte</button>}
      {success && <p className="mt-2 text-xs text-pos" role="status">Compte connecté et raccourci enregistré.</p>}
      {expanded && (
        <div id={`${id}-form`} className="mt-3 min-w-0 border-t border-line pt-4">
          <h4 className="text-sm font-medium">Connecter {app.name}</h4>
          <p className="mt-1 text-xs text-ink-3">Tu autoriseras la connexion auprès du service. Le lien ouvrira son site, qui peut demander de te reconnecter.</p>
          <form className="mt-4" onSubmit={handleSubmit} aria-busy={!!phase} aria-describedby={error ? `${id}-error` : undefined}>
            <fieldset disabled={!!phase} className="min-w-0 space-y-3">
              {app.integrations.length > 1 ? (
                <div>
                  <label className="label" htmlFor={`${id}-integration`}>Connexion proposée</label>
                  <select className="input" id={`${id}-integration`} name="integrationId" defaultValue={app.integrations[0].id} disabled={!!authorized}>
                    {app.integrations.map((integration) => <option key={integration.id} value={integration.id}>{integration.name}</option>)}
                  </select>
                </div>
              ) : <input type="hidden" name="integrationId" value={app.integrations[0]?.id ?? ""} />}
              <div>
                <label className="label" htmlFor={`${id}-name`}>Nom du raccourci</label>
                <input className="input" id={`${id}-name`} name="name" required maxLength={80} defaultValue={app.name} />
              </div>
              <div>
                <label className="label" htmlFor={`${id}-url`}>Lien d’accès à l’app</label>
                <input className="input" id={`${id}-url`} name="url" type="url" required maxLength={2048} defaultValue={app.url ?? ""} placeholder="https://mon-app.fr/" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                {!app.url && <p className="mt-1 text-xs text-ink-3">Indique le site à ouvrir depuis ton raccourci.</p>}
              </div>
              <div>
                <label className="label" htmlFor={`${id}-account`}>Nom du compte <span className="font-normal text-ink-3">(facultatif)</span></label>
                <input className="input" id={`${id}-account`} name="accountLabel" maxLength={160} placeholder="Ex. Mon compte professionnel" autoCapitalize="none" autoCorrect="off" />
                <p className="mt-1 text-xs text-ink-3">Un repère pour toi ; aucun mot de passe n’est demandé par Kaobase.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor={`${id}-category`}>Catégorie</label>
                  <select className="input" id={`${id}-category`} name="category" defaultValue={app.category}>
                    {APP_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor={`${id}-space`}>Espace</label>
                  <select className="input" id={`${id}-space`} name="space" defaultValue={defaultSpace}>
                    <option value="perso">Perso</option><option value="pro">Pro</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-2" htmlFor={`${id}-pinned`}>
                <input id={`${id}-pinned`} name="pinned" type="checkbox" defaultChecked className="h-4 w-4 shrink-0 accent-accent" />Afficher sur l’accueil
              </label>
              <button className="btn-primary" type="submit">{phase === "starting" ? "Préparation…" : phase === "authorizing" ? "Autorisation en cours…" : phase === "saving" ? "Enregistrement…" : authorized ? "Enregistrer le compte autorisé" : "Continuer vers la connexion"}</button>
            </fieldset>
          </form>
          {!phase && !authorized && <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => { setExpanded(false); setError(null); }}>Annuler</button>}
          {error && <p id={`${id}-error`} className="mt-3 text-sm text-neg" role="alert">{error}</p>}
          {authorized && error && <p className="mt-2 text-xs text-ink-3">L’autorisation a réussi. Tu peux corriger les informations ci-dessus, puis réessayer l’enregistrement.</p>}
        </div>
      )}
    </div>
  );
}
