"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Vue d'ensemble" },
  { href: "/transactions", label: "Opérations" },
  { href: "/subscriptions", label: "Abonnements" },
  { href: "/tasks", label: "Tâches" },
  { href: "/import", label: "Importer un relevé" },
  { href: "/agents", label: "Agents" },
  { href: "/agents/performance", label: "Ce qu'ils ont appris" },
  { href: "/settings", label: "Réglages" },
] as const;

export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" || href === "/agents" ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="border-b border-line md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
      <div className="flex items-center justify-between px-4 pt-4 md:block md:px-6 md:pt-8">
        <Link href="/" className="font-display text-[1.7rem] leading-none tracking-tight" aria-label="Kaobase, vue d'ensemble">
          kaobase
        </Link>
        <form action="/auth/signout" method="post" className="md:hidden">
          <button className="text-sm text-ink-2 hover:text-ink">Se déconnecter</button>
        </form>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 py-3 md:mt-8 md:flex-col md:gap-0.5 md:px-3" aria-label="Navigation principale">
        {LINKS.map((l) => {
          const active = isActive(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`relative whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
                active ? "text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
              } ${l.href === "/agents/performance" ? "md:pl-6" : ""}`}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-accent md:top-1/2 md:bottom-auto md:left-0 md:right-auto md:h-4 md:w-0.75 md:-translate-y-1/2"
                />
              )}
              {l.label}
            </Link>
          );
        })}
      </nav>
      <form action="/auth/signout" method="post" className="mt-auto hidden px-6 pb-6 md:block">
        <button className="text-sm text-ink-3 hover:text-ink">Se déconnecter</button>
      </form>
    </aside>
  );
}
