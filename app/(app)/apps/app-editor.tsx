"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { APP_CATEGORIES, type AppCategory, type AppShortcut } from "@/lib/apps";
import type { Space } from "@/lib/space-shared";
import { createAppAction, updateAppAction } from "./actions";

const PRESETS = [
  { name: "Gmail", url: "https://mail.google.com/", category: "communication" },
  { name: "Notion", url: "https://www.notion.so/", category: "work" },
  { name: "Netflix", url: "https://www.netflix.com/", category: "entertainment" },
  { name: "Spotify", url: "https://open.spotify.com/", category: "entertainment" },
] as const;

type AppPreset = { name: string; url: string | null; category: AppCategory };

export function AppEditor({ app, preset, defaultSpace = "perso" }: { app?: AppShortcut; preset?: AppPreset; defaultSpace?: Space }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [values, setValues] = useState(() => ({
    name: app?.name ?? preset?.name ?? "",
    url: app?.url ?? preset?.url ?? "",
    accountLabel: app?.account_label ?? "",
    category: app?.category ?? preset?.category ?? "other",
    space: app?.space ?? defaultSpace,
    pinned: app?.pinned ?? true,
  }));

  function resetValues() {
    setValues({
      name: app?.name ?? preset?.name ?? "",
      url: app?.url ?? preset?.url ?? "",
      accountLabel: app?.account_label ?? "",
      category: app?.category ?? preset?.category ?? "other",
      space: app?.space ?? defaultSpace,
      pinned: app?.pinned ?? true,
    });
    setError(null);
    setSuccess(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const result = app
          ? await updateAppAction(app.id, formData)
          : await createAppAction(formData);

        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (app || preset) {
          setEditing(false);
        } else {
          setValues({ name: "", url: "", accountLabel: "", category: "other", space: defaultSpace, pinned: true });
        }
        setSuccess(result.message ?? (app ? "App mise à jour." : "Raccourci ajouté."));
      } catch {
        setError("L’enregistrement a échoué. Réessaie dans un instant.");
      }
    });
  }

  if ((app || preset) && !editing) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => { resetValues(); setEditing(true); }}
          aria-label={app ? `Modifier ${app.name}` : `Ajouter un raccourci vers ${preset?.name}`}
        >
          {app ? "Modifier" : "Ajouter le raccourci"}
        </button>
        {success && <span className="text-xs text-pos" role="status">{success}</span>}
      </span>
    );
  }

  const form = (
    <form onSubmit={handleSubmit} aria-busy={pending} aria-describedby={error ? `${id}-error` : undefined}>
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        {!app && !preset && (
          <div>
            <p className="label">Pour commencer rapidement</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setValues((current) => ({ ...current, ...preset }));
                    setError(null);
                    setSuccess(null);
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor={`${id}-name`}>Nom de l’app</label>
            <input className="input" id={`${id}-name`} name="name" required maxLength={80} value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder="Ex. Ma banque" />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-category`}>Catégorie</label>
            <select className="input" id={`${id}-category`} name="category" value={values.category} onChange={(event) => setValues({ ...values, category: event.target.value as AppShortcut["category"] })}>
              {APP_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor={`${id}-url`}>Lien d’accès</label>
            <input className="input" id={`${id}-url`} name="url" type="url" required maxLength={2048} value={values.url} onChange={(event) => setValues({ ...values, url: event.target.value })} placeholder="https://mon-app.fr/connexion" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-account`}>E-mail ou identifiant <span className="font-normal text-ink-3">(facultatif)</span></label>
            <input className="input" id={`${id}-account`} name="accountLabel" maxLength={160} value={values.accountLabel} onChange={(event) => setValues({ ...values, accountLabel: event.target.value })} placeholder="Ex. mon.compte@exemple.fr" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </div>
          <div>
            <label className="label" htmlFor={`${id}-space`}>Espace</label>
            <select className="input" id={`${id}-space`} name="space" value={values.space} onChange={(event) => setValues({ ...values, space: event.target.value as Space })}>
              <option value="perso">Perso</option>
              <option value="pro">Pro</option>
            </select>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2" htmlFor={`${id}-pinned`}>
          <input className="h-4 w-4 shrink-0 accent-accent" id={`${id}-pinned`} name="pinned" type="checkbox" checked={values.pinned} onChange={(event) => setValues({ ...values, pinned: event.target.checked })} />
          Afficher le raccourci sur l’accueil
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary">{pending ? "Enregistrement…" : app ? "Enregistrer" : "Ajouter l’app"}</button>
          {(app || preset) && <button type="button" className="btn-ghost" onClick={() => { resetValues(); setEditing(false); }}>Annuler</button>}
        </div>
      </fieldset>
      {error && <p id={`${id}-error`} className="mt-3 text-sm text-neg" role="alert">{error}</p>}
      {success && <p className="mt-3 text-sm text-pos" role="status">{success}</p>}
    </form>
  );

  return app || preset ? <div className="w-full border-t border-line pt-4">{form}</div> : (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 className="section-title" id={`${id}-title`}>Ajouter une app</h2>
      {form}
    </section>
  );
}
