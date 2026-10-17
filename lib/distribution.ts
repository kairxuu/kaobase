import type { Category } from "./types";

export type DistributionItem = {
  id: string;
  name: string;
  color: string;
  amount: number;
};
export function categoryDistribution(
  rows: { category_id: string | null; amount: number }[],
  categories: Category[],
  debits = true,
): DistributionItem[] {
  const transfers = new Set(
    categories.filter((c) => c.kind === "transfer").map((c) => c.id),
  );
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.category_id && transfers.has(row.category_id)) continue;
    const amount = debits ? -Number(row.amount) : Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const key = row.category_id ?? "uncategorized";
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  const items = categories
    .filter((c) => c.kind === "expense" || totals.has(c.id))
    .filter((c) => c.kind !== "transfer")
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#8073bf",
      amount: Math.round((totals.get(c.id) ?? 0) * 100) / 100,
    }));
  for (const [id, amount] of totals)
    if (!items.some((c) => c.id === id))
      items.push({
        id,
        name: "Sans catégorie",
        color: "#8e8a96",
        amount: Math.round(amount * 100) / 100,
      });
  return items.sort(
    (a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "fr"),
  );
}
