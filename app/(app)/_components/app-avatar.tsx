"use client";

import Image from "next/image";
import { useState } from "react";
import type { AppShortcut } from "@/lib/apps";
import { appIconSource } from "@/lib/app-icons";

export function AppAvatar({ name, url, size = "md" }: {
  name: string;
  url?: string | null;
  category: AppShortcut["category"];
  size?: "sm" | "md";
}) {
  const source = appIconSource(url);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const pixels = size === "sm" ? 24 : 32;
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center overflow-hidden rounded-[3px] border border-line bg-white ${size === "sm" ? "h-9 w-9" : "h-12 w-12"}`}>
      {source && failedSource !== source ? (
        <Image src={source} alt={`Logo ${name}`} width={pixels} height={pixels} unoptimized
          referrerPolicy="no-referrer" className="object-contain" onError={() => setFailedSource(source)} />
      ) : (
        <svg width={pixels} height={pixels} viewBox="0 0 24 24" fill="none" stroke="#605a6e" strokeWidth="1.5">
          <rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" />
          <rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" />
        </svg>
      )}
    </span>
  );
}
