"use client";

import { useActionState, useState } from "react";
import { requestPasswordReset, signIn, signUp, type AuthState } from "./actions";

type Mode = "in" | "up" | "reset";

const ACTIONS = { in: signIn, up: signUp, reset: requestPasswordReset };

export function LoginForm({ initialMode = "in", notice }: { initialMode?: Mode; notice?: string }) {
  const [mode, setMode] = useState<Mode>(initialMode);

  return (
    <div className="space-y-5">
      {notice && <p className="rounded-md bg-warn-soft px-3 py-2 text-sm" role="status">{notice}</p>}
      {/* Une clé par mode : chaque formulaire repart d'un état vierge. */}
      <ModeForm key={mode} mode={mode} setMode={setMode} />
    </div>
  );
}

function ModeForm({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(ACTIONS[mode], {});

  return (
    <form action={action} className="space-y-5">
      {mode === "reset" ? (
        <div>
          <h2 className="font-display text-2xl">Mot de passe oublié</h2>
          <p className="mt-1 text-sm text-ink-2">Indique ton email : tu recevras un lien pour en choisir un nouveau.</p>
        </div>
      ) : (
        <div className="flex gap-6 border-b border-line text-sm" role="tablist">
          {(["in", "up"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`-mb-px border-b-2 pb-2 transition-colors ${
                mode === m ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"
              }`}
            >
              {m === "in" ? "J'ai un compte" : "Je découvre Kaobase"}
            </button>
          ))}
        </div>
      )}
      {mode === "up" && (
        <div>
          <label className="label" htmlFor="name">Prénom</label>
          <input className="input" id="name" name="name" autoComplete="given-name" />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" required autoComplete="email" />
      </div>
      {mode !== "reset" && (
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="password">Mot de passe</label>
            {mode === "in" && (
              <button type="button" onClick={() => setMode("reset")} className="text-xs text-accent hover:underline">
                Mot de passe oublié ?
              </button>
            )}
          </div>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            required
            minLength={mode === "up" ? 8 : undefined}
            autoComplete={mode === "in" ? "current-password" : "new-password"}
          />
          {mode === "up" && <p className="mt-1 text-xs text-ink-3">8 caractères minimum.</p>}
        </div>
      )}
      {state.error && <p className="text-sm text-neg" role="alert">{state.error}</p>}
      {state.info && <p className="text-sm text-pos" role="status">{state.info}</p>}
      <button className="btn-primary w-full py-2.5" disabled={pending}>
        {pending ? "Un instant…" : mode === "in" ? "Se connecter" : mode === "up" ? "Créer mon compte" : "Recevoir le lien"}
      </button>
      {mode === "reset" && (
        <button type="button" onClick={() => setMode("in")} className="w-full text-sm text-ink-2 hover:text-ink">
          Revenir à la connexion
        </button>
      )}
    </form>
  );
}
