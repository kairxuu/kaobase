"use client";
import { useState } from "react";
import { moneyIn } from "@/lib/ui/format";
import type { DistributionItem } from "@/lib/distribution";

export function CategoryDonut({
  items,
  currency,
  title,
  description,
}: {
  items: DistributionItem[];
  currency: string;
  title: string;
  description: string;
}) {
  const [unit, setUnit] = useState<"percent" | "money">("percent");
  const money = moneyIn(currency);
  const total = items.reduce((sum, c) => sum + c.amount, 0);
  const positive = items.filter((c) => c.amount > 0);
  const segments = positive.map((c, index) => {
    const percent = total ? (c.amount / total) * 100 : 0;
    const offset =
      (positive.slice(0, index).reduce((sum, item) => sum + item.amount, 0) /
        total) *
      100;
    return { ...c, percent, offset };
  });
  return (
    <section className="card min-w-0 space-y-5" aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title mb-1">{title}</h2>
          <p className="text-xs text-ink-2">{description}</p>
        </div>
        <div
          className="flex rounded-[3px] border border-line p-0.5"
          aria-label="Unité du graphique"
          role="group"
        >
          {(["percent", "money"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={unit === value}
              onClick={() => setUnit(value)}
              className={`rounded-[2px] px-3 py-1.5 text-xs ${unit === value ? "bg-accent-soft text-accent" : "text-ink-2"}`}
            >
              {value === "percent" ? "%" : currency}
            </button>
          ))}
        </div>
      </header>
      <div className="grid min-w-0 items-center gap-6 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
        <div className="relative mx-auto w-full max-w-55">
          <svg
            viewBox="0 0 200 200"
            role="img"
            aria-label={`${title} : ${money(total)}`}
            className="h-auto w-full"
          >
            <circle
              cx="100"
              cy="100"
              r="78"
              fill="none"
              stroke="var(--well)"
              strokeWidth="20"
            />
            {segments.map((c) => (
              <circle
                key={c.id}
                cx="100"
                cy="100"
                r="78"
                fill="none"
                stroke={c.color}
                strokeWidth="20"
                pathLength="100"
                strokeDasharray={`${c.percent} ${100 - c.percent}`}
                strokeDashoffset={-c.offset}
                transform="rotate(-90 100 100)"
              >
                <title>{`${c.name} : ${money(c.amount)} (${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(c.percent)} %)`}</title>
              </circle>
            ))}
          </svg>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center"
          >
            <span className="num text-lg font-semibold">{money(total)}</span>
            <span className="mt-1 text-xs text-ink-2">Total</span>
          </div>
        </div>
        {total === 0 ? (
          <p className="text-sm text-ink-2">
            Aucune dépense pour cette sélection.
          </p>
        ) : null}
        <ul
          className={`grid min-w-0 gap-x-6 gap-y-3 ${total === 0 ? "md:col-span-2" : ""}`}
        >
          {items.map((c) => (
            <li
              key={c.id}
              className="flex min-w-0 items-baseline justify-between gap-3 text-sm"
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  className="h-2 w-2 shrink-0"
                  style={{ background: c.color }}
                  aria-hidden
                />
                <span className="break-words">{c.name}</span>
              </span>
              <span className="num shrink-0 text-ink-2">
                {unit === "money"
                  ? money(c.amount)
                  : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(total ? (c.amount / total) * 100 : 0)} %`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
