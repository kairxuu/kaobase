import type { Metadata } from "next";
import { BrandLogo } from "@/app/brand-logo";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getOnboardingStatus, getSetupInitial, type SetupInitial } from "@/lib/data/onboarding";
import { Rosette } from "@/app/(app)/_components/rosette";
import { SetupForm } from "./setup-form";
import { finishSetup } from "./actions";

export const metadata: Metadata = { title: "Bienvenue" };

export default async function SetupPage() {
  // Cette page reste accessible avant configuration, sans le layout du tableau de bord.
  const { db, userId, email } = await requireSession();
  const status = await getOnboardingStatus(db, userId);
  if (status === "complete") redirect("/");
  let initial: SetupInitial | null = null;
  if (status === "pending") {
    try { initial = await getSetupInitial(db, userId); }
    catch (error) { console.error("[kaobase] chargement configuration :", error); }
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-10 md:py-10">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4">
        <BrandLogo />
        <form action="/auth/signout" method="post">
          <button className="btn-ghost btn-sm">Se déconnecter</button>
        </form>
      </header>
      <div className="mx-auto grid max-w-5xl gap-8 py-10 md:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        <section className="relative overflow-hidden">
          <Rosette opacity={0.25} className="pointer-events-none absolute -right-24 -top-32 w-96" bands={[
            { radius: 160, amplitude: 12, lobes: 18, curves: 10 },
            { radius: 105, amplitude: 14, lobes: 12, curves: 8 },
          ]} />
          <div className="relative">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-accent">Bienvenue chez toi</p>
            <h1 className="page-title">Un espace à ton image.</h1>
            <p className="page-lede">Quelques informations pour préparer tes comptes, tes échéances et tes agents.</p>
            <p className="mt-5 text-sm text-ink-3">Tu pourras retrouver ces choix dans les réglages.</p>
            <p className="mt-3 break-all text-xs text-ink-3">Connecté avec {email}</p>
          </div>
        </section>
        <section aria-label="Configuration de ton compte" className="min-w-0">
          {initial ? (
            <SetupForm initial={initial} action={finishSetup} timezones={["UTC", ...Intl.supportedValuesOf("timeZone")]} />
          ) : (
            <div className="card space-y-4" role="alert">
              <h2 className="section-title">Configuration momentanément indisponible</h2>
              <p className="text-sm text-ink-2">Tes informations sont conservées. Réessaie dans quelques instants.</p>
              <Link href="/setup" className="btn-primary">Réessayer</Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
