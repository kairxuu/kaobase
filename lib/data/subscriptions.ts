import "server-only";
import type { Supabase } from "@/lib/supabase/server";
import type { Subscription, SubscriptionStatus } from "@/lib/types";
import { detectSubscriptions, rollForward, type Period } from "@/lib/learning/subscriptions";
import { UserError } from "@/lib/errors";

const SUB_COLUMNS = "id, name, merchant, amount, period, next_due, status, confidence, category_id, notes";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function titleCase(merchant: string) {
  return merchant.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export async function listSubscriptions(
  supabase: Supabase,
  statuses: SubscriptionStatus[] = ["active", "suggested"],
): Promise<Subscription[]> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(SUB_COLUMNS)
    .in("status", statuses)
    .order("next_due", { ascending: true, nullsFirst: false });
  if (error) throw error;

  // Échéance passée : la prochaine occurrence est calculée à l'affichage, sans écrire en base
  // (revue D12). Elle est enregistrée à la détection et quand l'utilisateur modifie l'abonnement.
  const now = today();
  return (data as Subscription[])
    .map((s) => ({
      ...s,
      amount: Number(s.amount),
      confidence: Number(s.confidence),
      next_due: s.status === "active" ? rollForward(s.next_due, s.period, now) : s.next_due,
    }))
    .sort((a, b) => (a.next_due ?? "9999").localeCompare(b.next_due ?? "9999"));
}

// Lance l'algorithme de détection sur 18 mois d'historique.
// - nouveaux marchands récurrents -> abonnement « suggested » à confirmer ;
// - abonnements déjà suivis -> montant et échéance mis à jour ;
// - abonnements rejetés par l'utilisateur -> jamais reproposés.
export async function runSubscriptionDetection(supabase: Supabase) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 18);
  const [{ data: txs, error }, { data: existing }] = await Promise.all([
    supabase
      .from("transactions")
      .select("booked_at, amount, merchant, category_id")
      .lt("amount", 0)
      .gte("booked_at", since.toISOString().slice(0, 10))
      .limit(10000),
    supabase.from("subscriptions").select("id, merchant, status"),
  ]);
  if (error) throw error;

  const byMerchant = new Map((existing ?? []).map((s) => [s.merchant as string, s as { id: string; status: string }]));
  const exclude = new Set(
    [...byMerchant.entries()].filter(([, s]) => s.status === "rejected" || s.status === "cancelled").map(([m]) => m),
  );

  const rows = (txs ?? []).map((t) => ({
    bookedAt: t.booked_at as string,
    amount: Number(t.amount),
    merchant: t.merchant as string,
    categoryId: t.category_id as string | null,
  }));
  const candidates = detectSubscriptions(rows, { exclude });

  let created = 0;
  let updated = 0;
  for (const c of candidates) {
    const known = byMerchant.get(c.merchant);
    if (known) {
      await supabase
        .from("subscriptions")
        .update({ amount: c.amount, period: c.period, next_due: c.nextDue, confidence: c.confidence, updated_at: new Date().toISOString() })
        .eq("id", known.id);
      updated++;
    } else {
      const categoryCounts = new Map<string, number>();
      for (const r of rows) {
        if (r.merchant === c.merchant && r.categoryId) categoryCounts.set(r.categoryId, (categoryCounts.get(r.categoryId) ?? 0) + 1);
      }
      const categoryId = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const { error: insertError } = await supabase.from("subscriptions").insert({
        name: titleCase(c.merchant),
        merchant: c.merchant,
        amount: c.amount,
        period: c.period,
        next_due: c.nextDue,
        status: "suggested",
        confidence: c.confidence,
        category_id: categoryId,
      });
      if (!insertError) created++;
    }
  }
  return { detected: candidates.length, created, updated };
}

export async function updateSubscription(
  supabase: Supabase,
  id: string,
  patch: Partial<Pick<Subscription, "name" | "amount" | "period" | "next_due" | "status" | "notes" | "category_id">>,
) {
  const { data, error } = await supabase
    .from("subscriptions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(SUB_COLUMNS)
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function createSubscription(
  supabase: Supabase,
  input: { name: string; amount: number; period: Period; nextDue: string | null; merchant?: string },
) {
  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      name: input.name,
      merchant: (input.merchant ?? input.name).toUpperCase().trim(),
      amount: input.amount,
      period: input.period,
      next_due: input.nextDue,
      status: "active",
      confidence: 1,
    })
    .select(SUB_COLUMNS)
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function deleteSubscription(supabase: Supabase, id: string) {
  const { data, error } = await supabase.from("subscriptions").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new UserError("Abonnement introuvable");
}
