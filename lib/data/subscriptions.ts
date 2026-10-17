import "server-only";
import type { DatabaseClient } from "@/lib/database/server";
import type { Subscription, SubscriptionStatus } from "@/lib/types";
import type { Space, SpaceFilter } from "@/lib/space-shared";
import {
  detectSubscriptions,
  rollForward,
  type Period,
} from "@/lib/learning/subscriptions";
import { UserError } from "@/lib/errors";

const SUB_COLUMNS =
  "id, name, merchant, amount, period, next_due, anchor_day, status, confidence, category_id, notes, space";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function titleCase(merchant: string) {
  return merchant.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export async function listSubscriptions(
  db: DatabaseClient,
  statuses: SubscriptionStatus[] = ["active", "suggested"],
  space: SpaceFilter = "all",
): Promise<Subscription[]> {
  let q = db.from("subscriptions").select(SUB_COLUMNS).in("status", statuses);
  if (space !== "all") q = q.eq("space", space);
  const { data, error } = await q.order("next_due", {
    ascending: true,
    nullsFirst: false,
  });
  if (error) throw error;

  // Échéance passée : la prochaine occurrence est calculée à l'affichage, sans écrire en base
  // (revue D12). Elle est enregistrée à la détection et quand l'utilisateur modifie l'abonnement.
  const now = today();
  return (data as Subscription[])
    .map((s) => ({
      ...s,
      amount: Number(s.amount),
      confidence: Number(s.confidence),
      next_due:
        s.status === "active"
          ? rollForward(s.next_due, s.period, now, s.anchor_day)
          : s.next_due,
    }))
    .sort((a, b) => (a.next_due ?? "9999").localeCompare(b.next_due ?? "9999"));
}

// Lance l'algorithme de détection sur 18 mois d'historique.
// - nouveaux marchands récurrents -> abonnement « suggested » à confirmer ;
// - suggestions non modifiées -> montant et échéance mis à jour ;
// - abonnements pris en main par l'utilisateur -> jamais écrasés ;
// - abonnements rejetés par l'utilisateur -> jamais reproposés dans le même espace.
export async function runSubscriptionDetection(db: DatabaseClient) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 18);
  const [transactionsResult, existingResult, accountsResult] =
    await Promise.all([
      db
        .from("transactions")
        .select("booked_at, amount, merchant, category_id, account_id")
        .lt("amount", 0)
        .gte("booked_at", since.toISOString().slice(0, 10))
        .limit(10000),
      db
        .from("subscriptions")
        .select("id, merchant, status, space, detection_managed"),
      db.from("accounts").select("id, space"),
    ]);
  // Une lecture incomplète ne doit jamais produire de nouvelles suggestions.
  for (const result of [transactionsResult, existingResult, accountsResult]) {
    if (result.error) throw result.error;
  }
  const txs = transactionsResult.data;
  const existing = existingResult.data;
  // Un abonnement détecté prend l'espace du compte où il est prélevé (ticket #1).
  const spaceOf = new Map(
    (accountsResult.data ?? []).map((a) => [a.id as string, a.space as Space]),
  );

  const rows = (txs ?? []).map((t) => ({
    bookedAt: t.booked_at as string,
    amount: Number(t.amount),
    merchant: t.merchant as string,
    categoryId: t.category_id as string | null,
    space: spaceOf.get(t.account_id as string) ?? ("perso" as Space),
  }));
  let detected = 0;
  let created = 0;
  let updated = 0;
  for (const space of ["perso", "pro"] as const) {
    const spaceRows = rows.filter((r) => r.space === space);
    const byMerchant = new Map(
      (existing ?? [])
        .filter((s) => s.space === space)
        .map((s) => [s.merchant as string, s]),
    );
    const exclude = new Set(
      [...byMerchant.entries()]
        .filter(([, s]) => s.status === "rejected" || s.status === "cancelled")
        .map(([m]) => m),
    );
    const candidates = detectSubscriptions(spaceRows, { exclude });
    detected += candidates.length;
    for (const c of candidates) {
      const known = byMerchant.get(c.merchant);
      if (known) {
        if (known.status !== "suggested" || !known.detection_managed) continue;
        const { data, error } = await db
          .from("subscriptions")
          .update({
            amount: c.amount,
            period: c.period,
            next_due: c.nextDue,
            anchor_day: c.anchorDay,
            confidence: c.confidence,
            updated_at: new Date().toISOString(),
          })
          .eq("id", known.id)
          // Une modification utilisateur arrivée après la lecture garde la priorité.
          .eq("detection_managed", true)
          .eq("status", "suggested")
          .select("id");
        if (error) throw error;
        updated += data?.length ?? 0;
      } else {
        const categoryCounts = new Map<string, number>();
        for (const r of spaceRows) {
          if (r.merchant === c.merchant && r.categoryId)
            categoryCounts.set(
              r.categoryId,
              (categoryCounts.get(r.categoryId) ?? 0) + 1,
            );
        }
        const categoryId =
          [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
          null;
        const { data, error } = await db
          .from("subscriptions")
          .upsert(
            {
              name: titleCase(c.merchant),
              merchant: c.merchant,
              amount: c.amount,
              period: c.period,
              next_due: c.nextDue,
              anchor_day: c.anchorDay,
              status: "suggested",
              confidence: c.confidence,
              category_id: categoryId,
              space,
              detection_managed: true,
            },
            { onConflict: "user_id,space,merchant", ignoreDuplicates: true },
          )
          .select("id");
        if (error) throw error;
        created += data?.length ?? 0;
      }
    }
  }
  return { detected, created, updated };
}

export async function updateSubscription(
  db: DatabaseClient,
  id: string,
  patch: Partial<
    Pick<
      Subscription,
      | "name"
      | "amount"
      | "period"
      | "next_due"
      | "status"
      | "notes"
      | "category_id"
    >
  >,
) {
  let anchorPatch: { anchor_day?: number | null } = {};
  if (patch.next_due !== undefined) {
    anchorPatch = {
      anchor_day: patch.next_due ? Number(patch.next_due.slice(8, 10)) : null,
    };
    if (patch.next_due) {
      const { data: current, error } = await db
        .from("subscriptions")
        .select("period, next_due, anchor_day")
        .eq("id", id)
        .single();
      if (error) throw error;
      // Le formulaire réenvoie la date déjà avancée à l'affichage. Enregistrer
      // un montant en février ne doit pas transformer un prélèvement du 31 en 28.
      if (
        current.anchor_day &&
        (patch.period ?? current.period) === current.period &&
        (patch.next_due === current.next_due ||
          patch.next_due ===
            rollForward(
              current.next_due,
              current.period,
              today(),
              current.anchor_day,
            ))
      ) {
        anchorPatch = { anchor_day: current.anchor_day };
      }
    }
  }
  const { data, error } = await db
    .from("subscriptions")
    .update({
      ...patch,
      ...anchorPatch,
      detection_managed: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(SUB_COLUMNS)
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function createSubscription(
  db: DatabaseClient,
  input: {
    name: string;
    amount: number;
    period: Period;
    nextDue: string | null;
    merchant?: string;
    space?: Space;
    categoryId?: string | null;
  },
) {
  const { data, error } = await db
    .from("subscriptions")
    .insert({
      name: input.name,
      merchant: (input.merchant ?? input.name).toUpperCase().trim(),
      ...(input.categoryId !== undefined
        ? { category_id: input.categoryId }
        : {}),
      amount: input.amount,
      period: input.period,
      next_due: input.nextDue,
      anchor_day: input.nextDue ? Number(input.nextDue.slice(8, 10)) : null,
      status: "active",
      confidence: 1,
      space: input.space ?? "perso",
      detection_managed: false,
    })
    .select(SUB_COLUMNS)
    .single();
  if (error) throw error;
  return data as Subscription;
}

export async function deleteSubscription(db: DatabaseClient, id: string) {
  const { data, error } = await db
    .from("subscriptions")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new UserError("Abonnement introuvable");
}
