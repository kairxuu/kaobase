import type { Metadata } from "next";
import { BrandLogo } from "@/app/brand-logo";
import { Rosette } from "@/app/(app)/_components/rosette";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Connexion",
  description: "Connecte-toi à Kaobase ou crée ton compte pour importer tes relevés CSV ou OFX et classer tes opérations.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const initialMode = params.mode === "reset" ? "reset" : params.mode === "verify" ? "verify" : params.mode === "up" ? "up" : "in";
  const notice = params.lien === "expire" ? "Ce lien n'est plus valable. Demande un nouveau code ou connecte-toi." : undefined;
  return (
    <main className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative flex flex-col overflow-hidden px-6 pt-6 pb-5 md:px-12 lg:justify-between lg:gap-12 lg:py-10">
        <Rosette
          opacity={0.2}
          className="pointer-events-none absolute -right-32 -top-44 hidden w-[32rem] lg:block"
          bands={[
            { radius: 168, amplitude: 10, lobes: 20, curves: 12 },
            { radius: 118, amplitude: 16, lobes: 12, curves: 10 },
            { radius: 66, amplitude: 13, lobes: 7, curves: 8 },
          ]}
        />
        <BrandLogo className="relative" />
        <div className="relative mt-6 max-w-xl lg:mt-0">
          <h1 className="font-display text-[2rem] leading-tight tracking-tight sm:text-[2.5rem] lg:text-[3rem]">Où est passé ton argent ce mois-ci ?</h1>
          <p className="page-lede">
            Importe un relevé CSV ou OFX de ta banque pour retrouver tes dépenses par catégorie et repérer les paiements récurrents.
          </p>
          <figure className="mt-8 hidden border-y border-line py-5 lg:block">
            <figcaption className="mb-4 flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-2">
              <span className="font-medium text-ink">Un relevé, une fois importé</span>
              <span>Exemple fictif · montants en euros</span>
            </figcaption>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-ink-2">
                <tr><th scope="col" className="pb-3 font-normal">Opération</th><th scope="col" className="pb-3 font-normal">Catégorie</th><th scope="col" className="pb-3 text-right font-normal">Montant</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr><th scope="row" className="py-3 font-normal">Courses du samedi</th><td className="py-3 text-ink-2">Alimentation</td><td className="num py-3 text-right">−48,20</td></tr>
                <tr><th scope="row" className="py-3 font-normal">Abonnement musique</th><td className="py-3 text-ink-2">Loisirs</td><td className="num py-3 text-right">−10,99</td></tr>
                <tr><th scope="row" className="py-3 font-normal">Carte de transport</th><td className="py-3 text-ink-2">Transport</td><td className="num py-3 text-right">−30,00</td></tr>
              </tbody>
            </table>
            <p className="mt-4 text-xs leading-relaxed text-ink-2">Une catégorie ne convient pas ? Corrige-la : ce choix sera réutilisé pour les opérations du même commerçant lors des prochains imports.</p>
          </figure>
        </div>
        <p className="relative mt-6 hidden text-xs text-ink-2 lg:block">Les opérations sont ajoutées depuis les fichiers que tu importes.</p>
      </section>
      <section aria-label="Accès à ton compte" className="flex items-start justify-center px-6 pt-2 pb-10 md:px-12 lg:items-center lg:border-l lg:border-line lg:bg-surface lg:py-12">
        <div className="w-full max-w-sm">
          <LoginForm initialMode={initialMode} notice={notice} />
        </div>
      </section>
    </main>
  );
}
