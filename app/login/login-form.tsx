"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

export function LoginForm() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "in" ? signIn : signUp, {});

  return (
    <form action={action} className="card space-y-4">
      <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-sm">
        {(["in", "up"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md py-1.5 ${mode === m ? "bg-surface font-medium shadow-sm" : "text-ink-2"}`}
          >
            {m === "in" ? "Connexion" : "Créer un compte"}
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
      </div>
      {state.error && <p className="text-sm text-neg">{state.error}</p>}
      {state.info && <p className="text-sm text-pos">{state.info}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "…" : mode === "in" ? "Se connecter" : "Créer mon compte"}
      </button>
    </form>
  );
}
