"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

export function LoginForm() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "in" ? signIn : signUp, {});

  return (
    <form action={action} className="space-y-5">
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
      <div>
        <label className="label" htmlFor="password">Mot de passe</label>
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
      {state.error && <p className="text-sm text-neg" role="alert">{state.error}</p>}
      {state.info && <p className="text-sm text-pos" role="status">{state.info}</p>}
      <button className="btn-primary w-full py-2.5" disabled={pending}>
        {pending ? "Un instant…" : mode === "in" ? "Se connecter" : "Créer mon compte"}
      </button>
    </form>
  );
}
