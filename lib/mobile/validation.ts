import { z } from "zod";
import { CURRENCIES, ACCOUNT_KINDS } from "@/lib/profile-options";
import { isValidTimezone } from "@/lib/time";

const id = z.string().uuid();
const amount = z
  .number()
  .finite()
  .min(-1e10)
  .max(1e10)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.001,
    "Deux décimales maximum.",
  );
export const date = z.iso.date();
export const space = z.enum(["perso", "pro"]);
export const spaceFilter = z.enum(["all", "perso", "pro"]);
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const uuid = id;
export const currency = z.enum(
  CURRENCIES.map(([code]) => code) as [string, ...string[]],
);
export const profileInput = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    currency,
    timezone: z.string().max(100).refine(isValidTimezone),
  })
  .strict();
export const setupInput = profileInput.extend({
  accountId: id.nullable(),
  accountName: z.string().trim().min(1).max(60),
  accountKind: z.enum(ACCOUNT_KINDS),
  openingBalance: amount,
  space,
});
export const transactionInput = z
  .object({
    accountId: id.nullable(),
    bookedAt: date,
    amount,
    label: z.string().trim().min(1).max(500),
    categoryId: id.nullable(),
  })
  .strict();
export const taskInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000).nullable().optional(),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
    dueDate: date.nullable(),
    space,
  })
  .strict();
export const taskPatch = z
  .object({ status: z.enum(["todo", "doing", "done"]) })
  .strict();
export const subscriptionInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    amount: amount.refine((n) => n > 0),
    period: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    nextDue: date.nullable(),
    space,
    categoryId: id.nullable().optional(),
  })
  .strict();
export const subscriptionPatch = z
  .object({
    status: z.enum(["active", "rejected", "cancelled"]).optional(),
    categoryId: id.nullable().optional(),
  })
  .strict()
  .refine((p) => p.status !== undefined || p.categoryId !== undefined);
export const pinInput = z.object({ pinned: z.boolean() }).strict();
export const accountInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    kind: z.enum(ACCOUNT_KINDS),
    openingBalance: amount,
    space,
  })
  .strict();
export const budgetInput = z
  .object({ categoryId: id, monthlyLimit: amount.refine((n) => n > 0) })
  .strict();
export const agentInput = z
  .object({
    message: z.string().trim().min(1).max(4000),
    conversationId: id,
    agent: z
      .enum(["auto", "finance", "subscriptions", "tasks", "imports"])
      .default("auto"),
    space: spaceFilter.default("all"),
  })
  .strict();
