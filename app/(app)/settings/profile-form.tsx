"use client";

import { useState } from "react";
import { updateProfileAction } from "../actions";
import { FormAction } from "../_components/form-action";

type ProfileView = {
  firstName: string;
  lastName: string;
  email: string;
  pendingEmail: string | null;
  avatarColor: string;
  currency: string;
  timezone: string;
};

export function ProfileForm({
  profile,
  colors,
  currencies,
  timezones,
}: {
  profile: ProfileView;
  colors: readonly string[];
  currencies: readonly (readonly [string, string])[];
  timezones: readonly string[];
}) {
  const [first, setFirst] = useState(profile.firstName);
  const [last, setLast] = useState(profile.lastName);
  const [color, setColor] = useState(profile.avatarColor);
  const initials = `${first.trim()[0] ?? ""}${last.trim()[0] ?? ""}`.toUpperCase() || profile.email[0]?.toUpperCase() || "?";
  const knownCurrency = currencies.some(([code]) => code === profile.currency);

  return (
    <div className="space-y-6">
      <FormAction action={updateProfileAction} submitLabel="Enregistrer le profil" reset={false} className="space-y-4">
        <div className="flex items-center gap-4">
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full font-display text-xl text-white transition-colors"
            style={{ background: color }}
            aria-hidden
          >
            {initials}
          </span>
          <fieldset>
            <legend className="label">Couleur de l&apos;avatar</legend>
            <div className="flex flex-wrap gap-2">
              {colors.map((c) => (
                <label key={c} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="avatarColor"
                    value={c}
                    checked={color === c}
                    onChange={() => setColor(c)}
                    className="peer sr-only"
                  />
                  <span
                    className="block h-6 w-6 rounded-full ring-offset-2 ring-offset-[var(--sheet)] peer-checked:ring-2 peer-checked:ring-[var(--ink)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--signal)]"
                    style={{ background: c }}
                  />
                  <span className="sr-only">Couleur {c}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="firstName">Prénom</label>
            <input className="input" id="firstName" name="firstName" value={first} onChange={(e) => setFirst(e.target.value)} maxLength={60} autoComplete="given-name" />
          </div>
          <div>
            <label className="label" htmlFor="lastName">Nom</label>
            <input className="input" id="lastName" name="lastName" value={last} onChange={(e) => setLast(e.target.value)} maxLength={60} autoComplete="family-name" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="currency">Devise d&apos;affichage</label>
          <select className="input" id="currency" name="currency" defaultValue={profile.currency}>
            {!knownCurrency && <option value={profile.currency}>{profile.currency}</option>}
            {currencies.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-3">Change l&apos;affichage des montants ; aucune conversion n&apos;est appliquée.</p>
        </div>
        <div>
          <label className="label" htmlFor="timezone">Fuseau horaire</label>
          <input type="hidden" name="timezoneOriginal" value={profile.timezone} />
          <select className="input" id="timezone" name="timezone" defaultValue={profile.timezone}>
            {!timezones.includes(profile.timezone) && <option value={profile.timezone}>{profile.timezone}</option>}
            {timezones.map((tz) => (
              <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-3">Détecté depuis ton navigateur ; les agents comprennent « demain 14 h » à cette heure-là.</p>
        </div>
      </FormAction>

      <div className="border-t border-line pt-5">
        <p className="label">Adresse email</p>
        <p>{profile.email}</p>
        <p className="mt-1 text-xs text-ink-3">Le changement d’adresse n’est pas disponible pour le moment.</p>
      </div>
    </div>
  );
}
