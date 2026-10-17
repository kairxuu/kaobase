"use client";

import { useOptimistic, useTransition } from "react";
import { SPACE_LABEL, type SpaceFilter } from "@/lib/space-shared";
import { setSpaceAction } from "./actions";

const OPTIONS: SpaceFilter[] = ["all", "perso", "pro"];

// Sélecteur global Tout / Perso / Pro (ticket #1), mémorisé dans un cookie.
export function SpaceSwitcher({ value }: { value: SpaceFilter }) {
  const [pending, start] = useTransition();
  const [current, setCurrent] = useOptimistic(value);

  return (
    <div
      role="radiogroup"
      aria-label="Espace affiché"
      className={`inline-flex rounded-[3px] bg-surface-2 p-0.5 text-xs ${pending ? "opacity-70" : ""}`}
    >
      {OPTIONS.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={current === o}
          onClick={() =>
            start(async () => {
              setCurrent(o);
              await setSpaceAction(o);
            })
          }
          className={`rounded-[3px] px-3 py-1 transition-colors ${
            current === o ? "bg-surface font-medium text-ink shadow-[0_1px_0_var(--rule)]" : "text-ink-2 hover:text-ink"
          }`}
        >
          {SPACE_LABEL[o]}
        </button>
      ))}
    </div>
  );
}
