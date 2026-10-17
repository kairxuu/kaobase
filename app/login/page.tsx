import type { Metadata } from "next";
import { BrandLogo } from "@/app/brand-logo";
import { Rosette } from "@/app/(app)/_components/rosette";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const initialMode = params.mode === "reset" ? "reset" : params.mode === "verify" ? "verify" : params.mode === "up" ? "up" : "in";
  const notice = params.lien === "expire" ? "Ce lien n'est plus valable. Demande un nouveau code ou connecte-toi." : undefined;
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative flex flex-col justify-between overflow-hidden px-6 pt-8 pb-10 md:px-12 lg:py-12">
        <Rosette
          animate
          opacity={0.6}
          className="pointer-events-none absolute -top-[18%] -right-[30%] aspect-square w-[95%] min-w-[26rem] lg:-top-[12%] lg:-right-[22%] lg:w-[88%]"
          bands={[
            { radius: 168, amplitude: 10, lobes: 20, curves: 12 },
            { radius: 118, amplitude: 16, lobes: 12, curves: 10 },
            { radius: 66, amplitude: 13, lobes: 7, curves: 8 },
          ]}
        />
        <BrandLogo className="relative" />
        <div className="relative mt-56 max-w-xl lg:mt-0">
          <h1 className="page-title text-[2.4rem] md:text-[3rem]">Tes comptes, tes abonnements et tes tâches, au même endroit.</h1>
          <p className="page-lede">
            Importe tes relevés : Kaobase trie tes dépenses, repère tes abonnements et prévoit ton solde. Ses agents
            retiennent chacune de tes corrections.
          </p>
        </div>
      </section>
      <section className="flex items-center justify-center px-4 py-10 lg:border-l lg:border-line lg:bg-surface">
        <div className="w-full max-w-sm">
          <LoginForm initialMode={initialMode} notice={notice} />
        </div>
      </section>
    </main>
  );
}
