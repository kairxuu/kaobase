"use client";

import { useState, useTransition, type ReactNode } from "react";

type Result = { ok: true; data?: unknown; message?: string } | { ok: false; error: string };

// Bouton qui appelle une Server Action et affiche le résultat (ou l'erreur) sur place.
export function ActionButton({
  action,
  children,
  className = "btn-ghost btn-sm",
  confirm,
  onSuccess,
}: {
  action: () => Promise<Result>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  onSuccess?: () => void;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const res = await action();
            if (!res.ok) setMessage({ ok: false, text: res.error });
            else {
              setMessage(res.message ? { ok: true, text: res.message } : null);
              onSuccess?.();
            }
          });
        }}
      >
        {pending ? "…" : children}
      </button>
      {message && <span className={`text-xs ${message.ok ? "text-pos" : "text-neg"}`}>{message.text}</span>}
    </span>
  );
}
