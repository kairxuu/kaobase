"use client";

import Link from "next/link";
import { BrandLogo } from "@/app/brand-logo";
import { usePathname } from "next/navigation";
import type { AiUsage } from "@/lib/data/account";
import { AccountCard, Avatar, type AccountPreview } from "./account-card";
import type { SpaceFilter } from "@/lib/space-shared";
import { SpaceSwitcher } from "./space-switcher";

const LINKS = [
  { href: "/", label: "Vue d'ensemble" },
  { href: "/transactions", label: "Opérations" },
  { href: "/subscriptions", label: "Abonnements" },
  { href: "/apps", label: "Mes apps" },
  { href: "/tasks", label: "Tâches" },
  { href: "/import", label: "Importer un relevé" },
  { href: "/agents", label: "Agents" },
  { href: "/agents/performance", label: "Ce qu'ils ont appris" },
  { href: "/settings", label: "Réglages" },
] as const;

export function Nav({ account, usage, space }: { account: AccountPreview; usage: AiUsage; space: SpaceFilter }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" || href === "/agents" ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="border-b border-line md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
      <div className="flex items-center justify-between px-4 pt-4 md:block md:px-6 md:pt-8">
        <Link href="/" className="block w-36 max-w-full shrink-0 sm:w-44" aria-label="Kaobase, vue d'ensemble">
          <BrandLogo />
        </Link>
        <span className="flex items-center gap-3 md:hidden">
          <span className="num text-xs text-ink-3" title="Questions posées aux agents sur 24 h">
            IA {usage.questionsToday}/{usage.questionsLimit}
          </span>
          <Link href="/settings" aria-label={`Profil de ${account.name}`}>
            <Avatar account={account} size="sm" />
          </Link>
        </span>
      </div>
      <div className="px-4 pt-3 md:mt-6 md:px-6 md:pt-0">
        <SpaceSwitcher value={space} />
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 py-3 md:mt-4 md:flex-col md:gap-0.5 md:px-3" aria-label="Navigation principale">
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
      <div className="mt-auto hidden border-t border-line px-6 py-5 md:block">
        <AccountCard account={account} usage={usage} />
      </div>
    </aside>
  );
}
