import { describe, expect, it } from "vitest";
import { categoryDistribution } from "@/lib/distribution";
import { monthlyCost } from "@/lib/learning/subscriptions";
import type { Category } from "@/lib/types";
const categories: Category[] = [
  { id: "food", name: "Alimentation", kind: "expense", color: "#4433e0" },
  { id: "fun", name: "Loisirs", kind: "expense", color: "#8073bf" },
  {
    id: "transfer",
    name: "Virement épargne",
    kind: "transfer",
    color: "#000000",
  },
  { id: "salary", name: "Salaire", kind: "income", color: "#111111" },
];
describe("répartition par catégorie", () => {
  it("regroupe les dépenses et ignore revenus et virements vers un livret", () => {
    const result = categoryDistribution(
      [
        { category_id: "food", amount: -20 },
        { category_id: "food", amount: -10 },
        { category_id: "fun", amount: -10 },
        { category_id: "transfer", amount: -500 },
        { category_id: "salary", amount: 2000 },
        { category_id: null, amount: -5 },
      ],
      categories,
    );
    expect(result.map((c) => [c.name, c.amount])).toEqual([
      ["Alimentation", 30],
      ["Loisirs", 10],
      ["Sans catégorie", 5],
    ]);
    expect(result.reduce((sum, c) => sum + c.amount, 0)).toBe(45);
  });
  it("garde toutes les catégories de dépenses même à zéro, sans NaN", () => {
    expect(
      categoryDistribution([], categories).map((c) => [c.name, c.amount]),
    ).toEqual([
      ["Alimentation", 0],
      ["Loisirs", 0],
    ]);
  });
  it("ramène les abonnements annuels et mensuels à une même période", () => {
    const rows = [
      { category_id: "fun", amount: -monthlyCost(120, "yearly") },
      { category_id: "fun", amount: -monthlyCost(5, "monthly") },
    ];
    expect(
      categoryDistribution(rows, categories).find((c) => c.id === "fun")
        ?.amount,
    ).toBe(15);
  });
  it("arrondit les montants en fin de regroupement et inclut une catégorie absente", () => {
    const result = categoryDistribution(
      [
        { category_id: "food", amount: -0.1 },
        { category_id: "food", amount: -0.2 },
        { category_id: "removed", amount: -1.99 },
      ],
      categories,
    );
    expect(result.find((c) => c.id === "food")?.amount).toBe(0.3);
    expect(result.find((c) => c.id === "removed")).toMatchObject({
      name: "Sans catégorie",
      amount: 1.99,
    });
  });
});
