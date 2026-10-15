"use client";

import { useActionState } from "react";
import { updatePassword, type AuthState } from "@/app/login/actions";

export function PasswordForm({ redirectHome = false }: { redirectHome?: boolean }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(updatePassword, {});
  return (
    <form action={action} className="space-y-4">
      {redirectHome && <input type="hidden" name="then" value="home" />}
      <div>
        <label className="label" htmlFor="new-password">Nouveau mot de passe</label>
        <input className="input" id="new-password" name="password" type="password" minLength={8} required autoComplete="new-password" />
      </div>
      <div>
        <label className="label" htmlFor="confirm-password">Le même, une seconde fois</label>
        <input className="input" id="confirm-password" name="confirm" type="password" minLength={8} required autoComplete="new-password" />
      </div>
      {state.error && <p className="text-sm text-neg" role="alert">{state.error}</p>}
      {state.info && <p className="text-sm text-pos" role="status">{state.info}</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Un instant…" : "Enregistrer le mot de passe"}</button>
    </form>
  );
}
