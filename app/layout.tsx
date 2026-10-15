import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

// Bodoni Moda : valeur faciale d'un billet (titres, grands montants). Schibsted Grotesk : tout le reste.
const display = Bodoni_Moda({ variable: "--font-display", subsets: ["latin"], axes: ["opsz"], display: "swap" });
const sans = Schibsted_Grotesk({ variable: "--font-sans-ui", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Kaobase", template: "%s — Kaobase" },
  description: "Tes comptes, tes abonnements et tes tâches, avec des agents qui apprennent de tes choix.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ECEFE8" },
    { media: "(prefers-color-scheme: dark)", color: "#17121F" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${display.variable} ${sans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
