import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Supabase } from "@/lib/supabase/server";
import type { AgentId } from "@/lib/learning/router";
import {
  categorizeTransactions,
  getAccounts,
  getCategories,
  getTotalBalance,
  listTransactions,
  monthSummary,
  setTransactionCategory,
} from "@/lib/data/finance";
import {
  createSubscription,
  listSubscriptions,
  runSubscriptionDetection,
  updateSubscription,
} from "@/lib/data/subscriptions";
import { createTask, listTasks, planSubscriptionReminders, updateTask } from "@/lib/data/tasks";
import { annualCost, monthlyCost } from "@/lib/learning/subscriptions";
import { forecastBalance } from "@/lib/learning/forecast";
import { rememberFact } from "@/lib/learning/memory";

// Outils typés par secteur. Ils passent tous par le client Supabase de l'utilisateur :
// la RLS garantit qu'un agent ne peut jamais lire ou modifier les données d'un autre compte.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format AAAA-MM-JJ");
const period = z.enum(["weekly", "monthly", "quarterly", "yearly"]);

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function categoryResolver(supabase: Supabase) {
  const categories = await getCategories(supabase);
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const byId = new Map(categories.map((c) => [c.id, c]));
  return {
    categories,
    nameOf: (id: string | null) => (id ? (byId.get(id)?.name ?? "?") : "Non catégorisé"),
    idOf: (name: string) => byName.get(name.toLowerCase().trim())?.id,
  };
}

function sharedTools(supabase: Supabase, agent: AgentId): ToolSet {
  return {
    memoriser: tool({
      description:
        "Mémorise durablement un fait ou une préférence exprimée par l'utilisateur (ex : « mon loyer est payé le 5 », « je veux garder Spotify »). À utiliser dès qu'il partage une info utile pour plus tard.",
      inputSchema: z.object({
        fait: z.string().min(3).describe("Le fait, formulé à la 3e personne"),
        partager: z.boolean().default(false).describe("true si utile à tous les agents, pas seulement à toi"),
      }),
      execute: async ({ fait, partager }) => {
        await rememberFact(supabase, partager ? "shared" : agent, fait);
        return { ok: true };
      },
    }),
  };
}

function financeTools(supabase: Supabase): ToolSet {
  return {
    resume_mois: tool({
      description: "Revenus, dépenses, solde net et dépenses par catégorie pour un mois.",
      inputSchema: z.object({ mois: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("AAAA-MM, mois courant par défaut") }),
      execute: async ({ mois }) => monthSummary(supabase, mois ?? today().slice(0, 7)),
    }),
    lister_transactions: tool({
      description: "Liste des transactions filtrées (montants négatifs = dépenses).",
      inputSchema: z.object({
        du: isoDate.optional(),
        au: isoDate.optional(),
        categorie: z.string().optional().describe("Nom exact de catégorie"),
        recherche: z.string().optional().describe("Texte dans le libellé ou le marchand"),
        non_categorisees: z.boolean().optional(),
        limite: z.number().int().min(1).max(100).default(30),
      }),
      execute: async (args) => {
        const cats = await categoryResolver(supabase);
        const categoryId = args.categorie ? cats.idOf(args.categorie) : undefined;
        if (args.categorie && !categoryId) return { erreur: `Catégorie inconnue : ${args.categorie}` };
        const txs = await listTransactions(supabase, {
          from: args.du,
          to: args.au,
          categoryId,
          search: args.recherche,
          uncategorized: args.non_categorisees,
          limit: args.limite,
        });
        return txs.map((t) => ({
          id: t.id,
          date: t.booked_at,
          montant: t.amount,
          libelle: t.label_raw,
          marchand: t.merchant,
          categorie: cats.nameOf(t.category_id),
        }));
      },
    }),
    lister_categories: tool({
      description: "Catégories disponibles pour cet utilisateur.",
      inputSchema: z.object({}),
      execute: async () => (await getCategories(supabase)).map((c) => ({ nom: c.name, type: c.kind })),
    }),
    categoriser_transaction: tool({
      description:
        "Change la catégorie d'une transaction. KAOBASE apprend une règle pour ce marchand et l'applique aux autres transactions du même marchand.",
      inputSchema: z.object({ transaction_id: z.string().uuid(), categorie: z.string() }),
      execute: async ({ transaction_id, categorie }) => {
        const cats = await categoryResolver(supabase);
        const id = cats.idOf(categorie);
        if (!id) return { erreur: `Catégorie inconnue : ${categorie}`, disponibles: cats.categories.map((c) => c.name) };
        return setTransactionCategory(supabase, transaction_id, id);
      },
    }),
    soldes: tool({
      description: "Solde actuel de chaque compte et solde total.",
      inputSchema: z.object({}),
      execute: async () => {
        const accounts = await getAccounts(supabase);
        return { comptes: accounts, total: accounts.reduce((s, a) => s + Number(a.balance), 0) };
      },
    }),
    prevision: tool({
      description: "Projection du solde sur N jours (abonnements actifs + tendance des 90 derniers jours).",
      inputSchema: z.object({ jours: z.number().int().min(7).max(365).default(30) }),
      execute: async ({ jours }) => {
        const since = new Date();
        since.setUTCDate(since.getUTCDate() - 90);
        const [balance, subs, recent] = await Promise.all([
          getTotalBalance(supabase),
          listSubscriptions(supabase, ["active"]),
          listTransactions(supabase, { from: since.toISOString().slice(0, 10), limit: 5000 }),
        ]);
        const result = forecastBalance({
          today: today(),
          balance,
          horizonDays: jours,
          subscriptions: subs.map((s) => ({ merchant: s.merchant, amount: s.amount, period: s.period, nextDue: s.next_due })),
          recentTransactions: recent.map((t) => ({ bookedAt: t.booked_at, amount: t.amount, merchant: t.merchant })),
        });
        const min = result.points.reduce((a, b) => (b.balance < a.balance ? b : a));
        return {
          solde_actuel: balance,
          solde_final: result.points.at(-1)?.balance,
          point_bas: min,
          flux_variable_par_jour: result.variableDaily,
          abonnements_sur_la_periode: result.subscriptionsTotal,
        };
      },
    }),
  };
}

function subscriptionTools(supabase: Supabase): ToolSet {
  return {
    lister_abonnements: tool({
      description: "Abonnements suivis, avec coût mensuel et annuel. « suggested » = détecté, à confirmer.",
      inputSchema: z.object({ statut: z.enum(["active", "suggested", "cancelled", "rejected", "tous"]).default("tous") }),
      execute: async ({ statut }) => {
        const subs = await listSubscriptions(
          supabase,
          statut === "tous" ? ["active", "suggested", "cancelled"] : [statut],
        );
        return subs.map((s) => ({
          id: s.id,
          nom: s.name,
          statut: s.status,
          montant: s.amount,
          periode: s.period,
          prochaine_echeance: s.next_due,
          cout_mensuel: monthlyCost(s.amount, s.period),
          cout_annuel: annualCost(s.amount, s.period),
          confiance: s.confidence,
          notes: s.notes,
        }));
      },
    }),
    cout_total_abonnements: tool({
      description: "Coût total mensuel et annuel des abonnements actifs.",
      inputSchema: z.object({}),
      execute: async () => {
        const subs = await listSubscriptions(supabase, ["active"]);
        const mensuel = subs.reduce((s, x) => s + monthlyCost(x.amount, x.period), 0);
        return { nombre: subs.length, mensuel: Math.round(mensuel * 100) / 100, annuel: Math.round(mensuel * 12 * 100) / 100 };
      },
    }),
    detecter_abonnements: tool({
      description: "Relance l'algorithme de détection des paiements récurrents sur l'historique.",
      inputSchema: z.object({}),
      execute: async () => runSubscriptionDetection(supabase),
    }),
    modifier_abonnement: tool({
      description:
        "Met à jour un abonnement : confirmer (status=active), rejeter une suggestion (rejected), marquer résilié (cancelled), changer montant/période/échéance/notes.",
      inputSchema: z.object({
        id: z.string().uuid(),
        statut: z.enum(["active", "rejected", "cancelled"]).optional(),
        montant: z.number().positive().optional(),
        periode: period.optional(),
        prochaine_echeance: isoDate.optional(),
        notes: z.string().optional(),
      }),
      execute: async (a) =>
        updateSubscription(supabase, a.id, {
          status: a.statut,
          amount: a.montant,
          period: a.periode,
          next_due: a.prochaine_echeance,
          notes: a.notes,
        }),
    }),
    creer_abonnement: tool({
      description: "Ajoute manuellement un abonnement actif.",
      inputSchema: z.object({
        nom: z.string().min(1),
        montant: z.number().positive(),
        periode: period,
        prochaine_echeance: isoDate.optional(),
      }),
      execute: async (a) =>
        createSubscription(supabase, { name: a.nom, amount: a.montant, period: a.periode, nextDue: a.prochaine_echeance ?? null }),
    }),
  };
}

function taskTools(supabase: Supabase): ToolSet {
  return {
    lister_taches: tool({
      description: "Tâches de l'utilisateur, triées par échéance.",
      inputSchema: z.object({ statut: z.enum(["todo", "doing", "done", "ouvertes"]).default("ouvertes") }),
      execute: async ({ statut }) => {
        const tasks = await listTasks(supabase, statut === "ouvertes" ? ["todo", "doing"] : [statut]);
        return tasks.map((t) => ({
          id: t.id,
          titre: t.title,
          statut: t.status,
          priorite: t.priority,
          echeance: t.due_date,
          description: t.description,
        }));
      },
    }),
    creer_tache: tool({
      description: "Crée une tâche.",
      inputSchema: z.object({
        titre: z.string().min(1),
        description: z.string().optional(),
        priorite: z.enum(["low", "medium", "high"]).default("medium"),
        echeance: isoDate.optional(),
      }),
      execute: async (a) =>
        createTask(supabase, {
          title: a.titre,
          description: a.description,
          priority: a.priorite,
          dueDate: a.echeance,
          createdBy: "agent",
        }),
    }),
    modifier_tache: tool({
      description: "Modifie une tâche (statut, priorité, échéance, titre).",
      inputSchema: z.object({
        id: z.string().uuid(),
        statut: z.enum(["todo", "doing", "done"]).optional(),
        priorite: z.enum(["low", "medium", "high"]).optional(),
        echeance: isoDate.optional(),
        titre: z.string().optional(),
      }),
      execute: async (a) =>
        updateTask(supabase, a.id, { status: a.statut, priority: a.priorite, due_date: a.echeance, title: a.titre }),
    }),
    planifier_rappels_abonnements: tool({
      description: "Crée une tâche de vérification pour chaque abonnement prélevé dans les N prochains jours.",
      inputSchema: z.object({ jours: z.number().int().min(1).max(60).default(7) }),
      execute: async ({ jours }) => {
        const created = await planSubscriptionReminders(supabase, jours);
        return { creees: created.map((t) => ({ titre: t.title, echeance: t.due_date })) };
      },
    }),
  };
}

function importTools(supabase: Supabase): ToolSet {
  return {
    historique_imports: tool({
      description: "Derniers imports de relevés (lignes importées, doublons ignorés, lignes invalides).",
      inputSchema: z.object({}),
      execute: async () => {
        const { data } = await supabase
          .from("imports")
          .select("filename, format, rows_total, rows_imported, rows_duplicate, rows_invalid, created_at")
          .order("created_at", { ascending: false })
          .limit(10);
        return data ?? [];
      },
    }),
    controle_qualite: tool({
      description:
        "Contrôle qualité des données : transactions non catégorisées, part catégorisée par règles/IA/utilisateur, marchands à traiter en priorité.",
      inputSchema: z.object({}),
      execute: async () => {
        const txs = await listTransactions(supabase, { limit: 5000 });
        const by = { regle: 0, ia: 0, utilisateur: 0, aucune: 0 };
        const pending = new Map<string, number>();
        for (const t of txs) {
          if (t.categorized_by === "rule") by.regle++;
          else if (t.categorized_by === "llm") by.ia++;
          else if (t.categorized_by === "user") by.utilisateur++;
          else {
            by.aucune++;
            pending.set(t.merchant, (pending.get(t.merchant) ?? 0) + 1);
          }
        }
        return {
          transactions_analysees: txs.length,
          categorisation: by,
          marchands_non_categorises: [...pending.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([marchand, n]) => ({ marchand, transactions: n })),
        };
      },
    }),
    categoriser_non_classees: tool({
      description: "Catégorise toutes les transactions sans catégorie (règles apprises puis IA).",
      inputSchema: z.object({}),
      execute: async () => {
        const txs = await listTransactions(supabase, { uncategorized: true, limit: 1000 });
        return categorizeTransactions(supabase, txs);
      },
    }),
    detecter_abonnements: subscriptionTools(supabase).detecter_abonnements,
  };
}

export function toolsFor(agent: AgentId, supabase: Supabase): ToolSet {
  const specific = {
    finance: financeTools,
    subscriptions: subscriptionTools,
    tasks: taskTools,
    imports: importTools,
  }[agent](supabase);
  return { ...specific, ...sharedTools(supabase, agent) };
}
