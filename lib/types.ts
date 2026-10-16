import type { Period } from "@/lib/learning/subscriptions";
import type { AgentId } from "@/lib/learning/router";

export type { Period, AgentId };

export type Category = { id: string; name: string; kind: "expense" | "income" | "transfer"; color: string };

export type Account = { id: string; name: string; kind: string; currency: string; opening_balance: number };

export type Transaction = {
  id: string;
  account_id: string | null;
  booked_at: string;
  amount: number;
  label_raw: string;
  merchant: string;
  category_id: string | null;
  categorized_by: "rule" | "llm" | "user" | null;
  source: "csv" | "ofx" | "manual";
};

export type SubscriptionStatus = "suggested" | "active" | "rejected" | "cancelled";

export type Subscription = {
  id: string;
  name: string;
  merchant: string;
  amount: number;
  period: Period;
  next_due: string | null;
  anchor_day?: number | null;
  status: SubscriptionStatus;
  confidence: number;
  category_id: string | null;
  notes: string | null;
  space: "perso" | "pro";
};

export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "low" | "medium" | "high";

export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  subscription_id: string | null;
  transaction_id: string | null;
  created_by: "user" | "agent";
  created_at: string;
  completed_at: string | null;
  space: "perso" | "pro";
};

export type ImportRecord = {
  id: string;
  filename: string;
  format: "csv" | "ofx";
  rows_total: number;
  rows_imported: number;
  rows_duplicate: number;
  rows_invalid: number;
  created_at: string;
};
