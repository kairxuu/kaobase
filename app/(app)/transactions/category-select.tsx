"use client";

import { useState, useTransition } from "react";
import type { Category } from "@/lib/types";
import { setCategoryAction } from "../actions";

export function CategorySelect({
  transactionId,
  value,
  categories,
}: {
  transactionId: string;
  value: string | null;
  categories: Category[];
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <select
        className="input w-44 py-1"
        defaultValue={value ?? ""}
        disabled={pending}
        aria-label="Catégorie"
        onChange={(e) => {
          const next = e.target.value || null;
          start(async () => {
            const res = await setCategoryAction(transactionId, next);
            if (!res.ok) setNote(res.error);
            else {
              const n = (res.data as { propagated: number } | undefined)?.propagated ?? 0;
              setNote(n > 0 ? `+${n} appris` : null);
            }
          });
        }}
      >
        <option value="">Non catégorisé</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {note && <span className="text-xs text-accent">{note}</span>}
    </span>
  );
}
