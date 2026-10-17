import type { AppShortcut } from "@/lib/apps";

const CATEGORY_COLORS: Record<AppShortcut["category"], string> = {
  banking: "bg-pos/10 text-pos",
  work: "bg-accent-soft text-accent",
  communication: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  shopping: "bg-warn-soft text-warn",
  entertainment: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  other: "bg-surface-2 text-ink-2",
};

export function AppAvatar({
  name,
  category,
  size = "md",
}: {
  name: string;
  category: AppShortcut["category"];
  size?: "sm" | "md";
}) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.length > 1
    ? words.slice(0, 2).map((word) => Array.from(word)[0]).join("")
    : Array.from(words[0] ?? "?").slice(0, 2).join("");

  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-xl font-semibold uppercase ${CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other} ${size === "sm" ? "h-9 w-9 text-xs" : "h-12 w-12 text-sm"}`}
    >
      {initials}
    </span>
  );
}
