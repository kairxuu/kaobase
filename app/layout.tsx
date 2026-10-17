import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ variable: "--font-sans-ui", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Kaobase", template: "%s — Kaobase" },
  description: "Importe tes relevés CSV ou OFX dans Kaobase pour classer tes opérations, retrouver tes abonnements et suivre tes échéances.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ECEFE8" },
    { media: "(prefers-color-scheme: dark)", color: "#17121F" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${sans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
