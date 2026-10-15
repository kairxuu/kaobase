"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Tableau de bord" },
  { href: "/transactions", label: "Transactions" },
  { href: "/subscriptions", label: "Abonnements" },
  { href: "/tasks", label: "Tâches" },
  { href: "/import", label: "Import" },
  { href: "/agents", label: "Agents IA" },
  { href: "/agents/performance", label: "Performance IA" },
  { href: "/settings", label: "Réglages" },
] as const;

export function Nav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || (pathname.startsWith(href + "/") && href !== "/agents");

  return (
    <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
      <div className="flex items-center justify-between px-4 py-4 md:block md:px-5 md:py-6">
        <Link href="/" className="font-mono text-lg font-semibold tracking-tight">
          KAOBASE
        </Link>
        <form action="/auth/signout" method="post" className="md:hidden">
          <button className="text-xs text-ink-3 hover:text-ink">Déconnexion</button>
        </form>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${
              active(l.href) ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-surface-2"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <form action="/auth/signout" method="post" className="absolute bottom-5 left-5 hidden md:block">
        <button className="text-xs text-ink-3 hover:text-ink">Déconnexion</button>
      </form>
    </aside>
  );
}
