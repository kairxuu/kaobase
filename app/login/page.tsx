import type { Metadata } from "next";
import { BrandLogo } from "@/app/brand-logo";
import { LoginForm } from "./login-form";
import "./page.css";

export const metadata: Metadata = {
  title: "Connexion",
  description: "Connecte-toi à Kaobase ou crée ton compte pour importer tes relevés CSV ou OFX et classer tes opérations.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const initialMode = params.mode === "reset" ? "reset" : params.mode === "verify" ? "verify" : params.mode === "up" ? "up" : "in";
  const notice = params.lien === "expire" ? "Ce lien n'est plus valable. Demande un nouveau code ou connecte-toi." : undefined;

  return (
    <main className="login-page">
      <header className="login-masthead">
        <BrandLogo />
        <p className="login-descriptor">Carnet de comptes personnel</p>
      </header>

      <div className="login-introduction">
        <p className="login-index">COMPTES / OPÉRATIONS / ÉCHÉANCES</p>
        <h1 className="login-title">Accéder à Kaobase.</h1>
      </div>

      <div className="login-workspace">
        <section aria-label="Accès à ton compte" className="login-access">
          <LoginForm initialMode={initialMode} notice={notice} />
        </section>

        <aside className="login-notebook" aria-labelledby="notebook-title">
          <div className="login-noteHeading">
            <span className="login-noteNumber" aria-hidden="true">01</span>
            <div>
              <h2 id="notebook-title">Partir de ton relevé.</h2>
              <p>Exporte un fichier CSV ou OFX depuis ta banque, puis importe-le dans ton espace.</p>
            </div>
          </div>
          <figure className="login-statement">
            <figcaption>
              <span>Exemple après import</span>
              <span>Données fictives · EUR</span>
            </figcaption>
            <table>
              <thead>
                <tr><th scope="col">Libellé / catégorie</th><th scope="col">Débit</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">Épicerie du quartier<span>Alimentation</span></th><td>48,20</td></tr>
                <tr><th scope="row">Abonnement musique<span>Loisirs</span></th><td>10,99</td></tr>
                <tr><th scope="row">Carte de transport<span>Transport</span></th><td>30,00</td></tr>
              </tbody>
              <tfoot><tr><th scope="row">Total de cet exemple</th><td>89,19</td></tr></tfoot>
            </table>
          </figure>
          <div className="login-noteHeading">
            <span className="login-noteNumber" aria-hidden="true">02</span>
            <div>
              <h2>Garder tes propres catégories.</h2>
              <p>Si une opération est mal classée, corrige sa catégorie. Kaobase réutilise ton choix pour le même commerçant lors des prochains imports.</p>
            </div>
          </div>
        </aside>
      </div>

      <footer className="login-footer">
        <span>Kaobase</span>
        <p>Les opérations sont ajoutées depuis les fichiers que tu importes.</p>
      </footer>
    </main>
  );
}
