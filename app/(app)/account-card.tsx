import Link from "next/link";
import type { AiUsage } from "@/lib/data/account";

export type AccountPreview = { name: string; email: string; initials: string; color: string };

const tokens = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

export function Avatar({ account, size = "md" }: { account: AccountPreview; size?: "sm" | "md" }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-display text-white ${size === "sm" ? "h-8 w-8 text-sm" : "h-10 w-10 text-base"}`}
      style={{ background: account.color }}
      aria-hidden
    >
      {account.initials}
    </span>
  );
}

// Aperçu du compte en bas de la barre latérale : qui est connecté et ce qu'il reste de quota IA.
export function AccountCard({ account, usage }: { account: AccountPreview; usage: AiUsage }) {
  const ratio = Math.min(1, usage.questionsToday / usage.questionsLimit);
  const left = Math.max(0, usage.questionsLimit - usage.questionsToday);
  const paused = usage.questionsThisMinute >= usage.minuteLimit;
  const tone = ratio >= 0.9 ? "var(--loss)" : ratio >= 0.7 ? "var(--warn)" : "var(--signal)";

  return (
    <div className="space-y-4">
      <Link href="/settings" className="flex items-center gap-3 rounded-md p-1 -m-1 hover:bg-surface-2" aria-label="Ouvrir ton profil">
        <Avatar account={account} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{account.name}</span>
          <span className="block truncate text-xs text-ink-3">{account.email}</span>
        </span>
      </Link>

      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-2">Agents IA, 24 h</span>
          <span className="num text-ink">
            {usage.questionsToday}/{usage.questionsLimit}
          </span>
        </div>
        <div
          className="mt-1.5 h-[3px] rounded-full bg-surface-2"
          role="meter"
          aria-label="Questions posées aux agents sur 24 heures"
          aria-valuemin={0}
          aria-valuemax={usage.questionsLimit}
          aria-valuenow={usage.questionsToday}
        >
          <div className="h-[3px] rounded-full transition-[width]" style={{ width: `${ratio * 100}%`, background: tone }} />
        </div>
        <p className="mt-1.5 text-xs text-ink-3">
          {paused
            ? `Pause : ${usage.minuteLimit} questions dans la minute, réessaie bientôt.`
            : `Encore ${left} question${left > 1 ? "s" : ""}, ${tokens.format(usage.tokensToday)} tokens utilisés.`}
        </p>
      </div>

      <form action="/auth/signout" method="post">
        <button className="text-sm text-ink-3 hover:text-ink">Se déconnecter</button>
      </form>
    </div>
  );
}
