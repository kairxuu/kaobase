"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";

type Result = { ok: true; data?: unknown; message?: string } | { ok: false; error: string };

// Formulaire branché sur une Server Action qui renvoie { ok, error } ; se vide en cas de succès.
export function FormAction({
  action,
  children,
  className,
  submitLabel,
  reset = true,
}: {
  action: (formData: FormData) => Promise<Result>;
  children: ReactNode;
  className?: string;
  submitLabel: string;
  reset?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        start(async () => {
          const res = await action(formData);
          if (!res.ok) {
            setError(res.error);
            setSuccess(null);
          } else {
            setError(null);
            setSuccess(res.message ?? null);
            if (reset) ref.current?.reset();
          }
        });
      }}
    >
      {children}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>
          {pending ? "…" : submitLabel}
        </button>
        {error && <span className="text-xs text-neg" role="alert">{error}</span>}
        {success && <span className="text-xs text-pos" role="status">{success}</span>}
      </div>
    </form>
  );
}
