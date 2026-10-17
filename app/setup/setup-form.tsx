"use client";

import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { CURRENCIES } from "@/lib/profile-options";

type AccountKind = "checking" | "savings" | "card" | "cash" | "other";
type SetupState = { error?: string };
type SetupInitial = {
  displayName: string;
  currency: string;
  timezone: string;
  timezoneManual?: boolean;
  accountId: string | null;
  accountName: string;
  accountKind: AccountKind;
  openingBalance: string;
  space: "perso" | "pro";
  hasTransactions: boolean;
};
type FieldError = { field: "displayName" | "accountName" | "openingBalance"; message: string };

const STEPS = ["Tes préférences", "Ton compte", "Récapitulatif"] as const;
const ACCOUNT_KINDS: readonly (readonly [AccountKind, string])[] = [
  ["checking", "Compte courant"],
  ["savings", "Épargne"],
  ["card", "Carte"],
  ["cash", "Espèces"],
  ["other", "Autre"],
];

// Le snapshot serveur garde le rendu initial stable, puis React lit le fuseau
// du navigateur après l'hydratation, sans écraser un choix de l'utilisateur.
const subscribeToTimezone = () => () => {};
function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "Europe/Paris";
  }
}

function displayBalance(value: string, currency: string) {
  const amount = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(amount)) return value;
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toLocaleString("fr-FR")} ${currency}`;
  }
}

export function SetupForm({
  initial,
  action,
  timezones,
}: {
  initial: SetupInitial;
  action: (previous: SetupState, formData: FormData) => Promise<SetupState>;
  timezones: readonly string[];
}) {
  const [state, formAction, pending] = useActionState<SetupState, FormData>(action, {});
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [currency, setCurrency] = useState(initial.currency);
  const [timezoneChoice, setTimezoneChoice] = useState<string | null>(null);
  const [accountName, setAccountName] = useState(initial.accountName);
  const [accountKind, setAccountKind] = useState(initial.accountKind);
  const [openingBalance, setOpeningBalance] = useState(initial.openingBalance);
  const [space, setSpace] = useState(initial.space);
  const [fieldError, setFieldError] = useState<FieldError | null>(null);
  const detectedTimezone = useSyncExternalStore(subscribeToTimezone, browserTimezone, () => initial.timezone);
  const timezone = timezoneChoice ?? (initial.timezoneManual ? initial.timezone : detectedTimezone);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const serverErrorRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  const fieldId = (field: string) => `${id}-${field}`;

  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (state.error) serverErrorRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (fieldError) {
      const input = formRef.current?.querySelector<HTMLInputElement>(`[data-field="${fieldError.field}"]`);
      input?.focus();
    }
  }, [fieldError]);

  function validateStep(current: number): FieldError | null {
    if (current === 0 && (!displayName.trim() || displayName.trim().length > 60)) {
      return { field: "displayName", message: "Indique ton prénom ou un nom de 60 caractères maximum." };
    }
    if (current === 1) {
      if (!accountName.trim() || accountName.trim().length > 60) {
        return { field: "accountName", message: "Donne un nom à ton compte, en 60 caractères maximum." };
      }
      if (!initial.hasTransactions && (
        !/^[+-]?\d+(?:[.,]\d{1,2})?$/.test(openingBalance.trim())
        || Math.abs(Number(openingBalance.trim().replace(",", "."))) > 999999999999.99
      )) {
        return { field: "openingBalance", message: "Indique un montant valide, par exemple 1250,50 ou -25,00." };
      }
    }
    return null;
  }

  function goToStep(next: number) {
    setFieldError(null);
    setStep(next);
  }

  const balance = initial.hasTransactions ? initial.openingBalance : openingBalance;
  const accountSpace = initial.hasTransactions ? initial.space : space;
  const currencyLabel = CURRENCIES.find(([code]) => code === currency)?.[1] ?? currency;

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      aria-busy={pending}
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        const stepsToValidate = step === 2 ? [0, 1] : [step];
        for (const current of stepsToValidate) {
          const error = validateStep(current);
          if (error) {
            event.preventDefault();
            setStep(current);
            setFieldError(error);
            return;
          }
        }
        if (step < 2) {
          event.preventDefault();
          goToStep(step + 1);
        }
      }}
      className="min-w-0 space-y-7"
    >
      {/* Un champ par valeur : les étapes démontées ne perdent pas leurs données. */}
      <input type="hidden" name="displayName" value={displayName} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="accountId" value={initial.accountId ?? ""} />
      <input type="hidden" name="accountName" value={accountName} />
      <input type="hidden" name="accountKind" value={accountKind} />
      <input type="hidden" name="openingBalance" value={balance} />
      {(step !== 1 || initial.hasTransactions) && <input type="hidden" name="space" value={accountSpace} />}

      <ol className="grid grid-cols-3 gap-2" aria-label="Étapes de la configuration">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined}>
            <div className={`mb-2 h-1 rounded-full ${index <= step ? "bg-accent" : "bg-surface-2"}`} />
            <span className={`text-xs ${index === step ? "font-medium text-ink" : "text-ink-2"}`}>
              <span className="sr-only">Étape </span>{index + 1}. {label}
              {index < step && <span className="sr-only">, terminée</span>}
            </span>
          </li>
        ))}
      </ol>

      <section aria-labelledby={fieldId("title")} className="card space-y-6 sm:p-7">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-accent">Étape {step + 1} sur 3</p>
          <h2 ref={titleRef} id={fieldId("title")} tabIndex={-1} className="font-display text-3xl leading-tight">
            {step === 0 ? "Fais comme chez toi." : step === 1 ? initial.accountId ? "Prépare ton compte." : "Ton premier compte." : "Tout est prêt."}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            {step === 0
              ? "Quelques préférences pour adapter Kaobase à ton quotidien. Tu pourras les modifier dans Réglages."
              : step === 1
                ? "Choisis un compte de départ pour retrouver tes dépenses et suivre ton solde."
                : "Vérifie tes informations, puis ouvre ton tableau de bord."}
          </p>
        </div>

        {step === 0 && (
          <fieldset disabled={pending} className="space-y-5">
            <legend className="sr-only">Tes préférences</legend>
            <div>
              <label className="label" htmlFor={fieldId("displayName")}>Comment veux-tu qu&apos;on t&apos;appelle ?</label>
              <input
                className="input"
                id={fieldId("displayName")}
                data-field="displayName"
                value={displayName}
                onChange={(event) => { setDisplayName(event.target.value); setFieldError(null); }}
                maxLength={60}
                autoComplete="given-name"
                placeholder="Ton prénom"
                required
                aria-invalid={fieldError?.field === "displayName" || undefined}
                aria-describedby={fieldError?.field === "displayName" ? fieldId("field-error") : undefined}
              />
            </div>
            <div>
              <label className="label" htmlFor={fieldId("currency")}>Devise d&apos;affichage</label>
              <select className="input" id={fieldId("currency")} value={currency} onChange={(event) => setCurrency(event.target.value)} aria-describedby={fieldId("currency-help")}>
                {!CURRENCIES.some(([code]) => code === currency) && <option value={currency}>{currency}</option>}
                {CURRENCIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
              <p id={fieldId("currency-help")} className="mt-1.5 text-xs leading-relaxed text-ink-3">Les montants ne sont pas convertis : cette préférence change seulement leur affichage.</p>
            </div>
            <div>
              <label className="label" htmlFor={fieldId("timezone")}>Fuseau horaire</label>
              <select className="input" id={fieldId("timezone")} value={timezone} onChange={(event) => setTimezoneChoice(event.target.value)} aria-describedby={fieldId("timezone-help")}>
                {!timezones.includes(timezone) && <option value={timezone}>{timezone.replace(/_/g, " ")}</option>}
                {timezones.map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}
              </select>
              <p id={fieldId("timezone-help")} className="mt-1.5 text-xs leading-relaxed text-ink-3">
                {initial.timezoneManual ? "Ton fuseau actuel est conservé." : "Détecté depuis ton navigateur."} Il sert à afficher tes échéances à la bonne heure.
              </p>
            </div>
          </fieldset>
        )}

        {step === 1 && (
          <fieldset disabled={pending} className="space-y-5">
            <legend className="sr-only">Ton compte de départ</legend>
            <div>
              <label className="label" htmlFor={fieldId("accountName")}>Nom du compte</label>
              <input
                className="input"
                id={fieldId("accountName")}
                data-field="accountName"
                value={accountName}
                onChange={(event) => { setAccountName(event.target.value); setFieldError(null); }}
                maxLength={60}
                placeholder="Ex. Mon compte courant"
                required
                aria-invalid={fieldError?.field === "accountName" || undefined}
                aria-describedby={fieldError?.field === "accountName" ? fieldId("field-error") : undefined}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor={fieldId("accountKind")}>Type de compte</label>
                <select className="input" id={fieldId("accountKind")} value={accountKind} onChange={(event) => setAccountKind(event.target.value as AccountKind)}>
                  {ACCOUNT_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor={fieldId("openingBalance")}>Solde d&apos;ouverture ({currency})</label>
                <input
                  className="input disabled:opacity-60"
                  id={fieldId("openingBalance")}
                  data-field="openingBalance"
                  inputMode="decimal"
                  value={balance}
                  onChange={(event) => { setOpeningBalance(event.target.value); setFieldError(null); }}
                  disabled={initial.hasTransactions}
                  required
                  aria-invalid={fieldError?.field === "openingBalance" || undefined}
                  aria-describedby={fieldError?.field === "openingBalance" ? `${fieldId("balance-help")} ${fieldId("field-error")}` : fieldId("balance-help")}
                />
              </div>
            </div>
            <p id={fieldId("balance-help")} className="-mt-2 text-xs leading-relaxed text-ink-3">
              Le solde d&apos;ouverture est le montant avant les premières opérations que tu ajouteras ou importeras.
            </p>
            <fieldset disabled={initial.hasTransactions} aria-describedby={initial.hasTransactions ? fieldId("existing-account-help") : undefined}>
              <legend className="label">Dans quel espace suivre ce compte ?</legend>
              <div className="grid gap-3 min-[380px]:grid-cols-2">
                {(["perso", "pro"] as const).map((value) => (
                  <label key={value} className={`flex items-center gap-2.5 rounded-md border px-4 py-3 text-sm ${accountSpace === value ? "border-accent bg-accent-soft" : "border-line"} ${initial.hasTransactions ? "opacity-60" : "cursor-pointer"}`}>
                    <input type="radio" name="space" value={value} checked={accountSpace === value} onChange={() => setSpace(value)} className="accent-[var(--signal)]" />
                    {value === "perso" ? "Personnel" : "Professionnel"}
                  </label>
                ))}
              </div>
            </fieldset>
            {initial.hasTransactions && (
              <p id={fieldId("existing-account-help")} className="rounded-md bg-surface-2 px-4 py-3 text-xs leading-relaxed text-ink-2">
                Ce compte contient déjà des opérations. Son solde d&apos;ouverture et son espace sont conservés pour préserver ton historique. Tu pourras les ajuster dans Réglages.
              </p>
            )}
          </fieldset>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Tes préférences</h3>
                <button type="button" className="btn-ghost btn-sm" disabled={pending} onClick={() => goToStep(0)} aria-label="Modifier tes préférences">Modifier</button>
              </div>
              <dl className="space-y-2 text-sm">
                <SummaryRow label="Ton nom" value={displayName.trim()} />
                <SummaryRow label="Devise" value={currencyLabel} />
                <SummaryRow label="Fuseau horaire" value={timezone.replace(/_/g, " ")} />
              </dl>
            </div>
            <div className="border-t border-line pt-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Ton compte de départ</h3>
                <button type="button" className="btn-ghost btn-sm" disabled={pending} onClick={() => goToStep(1)} aria-label="Modifier ton compte de départ">Modifier</button>
              </div>
              <dl className="space-y-2 text-sm">
                <SummaryRow label="Nom du compte" value={accountName.trim()} />
                <SummaryRow label="Type" value={ACCOUNT_KINDS.find(([value]) => value === accountKind)?.[1] ?? accountKind} />
                <SummaryRow label="Solde d'ouverture" value={displayBalance(balance, currency)} />
                <SummaryRow label="Espace" value={accountSpace === "perso" ? "Personnel" : "Professionnel"} />
              </dl>
            </div>
            <p className="rounded-md bg-accent-soft px-4 py-3 text-sm leading-relaxed">
              Ensuite, tu pourras importer un relevé, ajouter une opération ou découvrir tes agents.
            </p>
          </div>
        )}

        {fieldError && <p id={fieldId("field-error")} role="alert" className="text-sm text-neg">{fieldError.message}</p>}
        {state.error && <p ref={serverErrorRef} tabIndex={-1} role="alert" className="rounded-md bg-warn-soft px-4 py-3 text-sm text-neg">{state.error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          {step > 0 ? (
            <button type="button" className="btn-ghost" disabled={pending} onClick={() => goToStep(step - 1)}>Retour</button>
          ) : <span className="text-xs text-ink-3">Environ une minute</span>}
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Configuration en cours…" : step === 2 ? "Ouvrir mon tableau de bord" : "Continuer"}
          </button>
        </div>
      </section>
    </form>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-5 gap-y-1">
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 max-w-full text-right font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
