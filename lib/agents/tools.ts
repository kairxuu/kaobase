import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Supabase } from "@/lib/supabase/server";
import type { AgentId } from "@/lib/learning/router";
import type { Category } from "@/lib/types";
import { defaultSpace, type Space, type SpaceFilter } from "@/lib/space-shared";
import {
  addManualTransaction,
  categorizeTransactions,
  createAccount,
  createCategory,
  deleteTransaction,
  getAccounts,
  getTransaction,
  getCategories,
  getTotalBalance,
  listTransactions,
  monthRange,
  monthSummary,
  rankMerchants,
  setTransactionCategory,
  updateTransaction,
} from "@/lib/data/finance";
import {
  createSubscription,
  listSubscriptions,
  runSubscriptionDetection,
  updateSubscription,
} from "@/lib/data/subscriptions";
import { createTask, deleteTask, listTasks, planSubscriptionReminders, updateTask } from "@/lib/data/tasks";
import { budgetStatus, BUDGETS_MISSING, deleteBudget, setBudget } from "@/lib/data/budgets";
import { annualCost, monthlyCost } from "@/lib/learning/subscriptions";
import { forecastBalance } from "@/lib/learning/forecast";
import { rememberFact } from "@/lib/learning/memory";

// Outils typés par secteur. Ils passent tous par le client Supabase de l'utilisateur :
// la RLS garantit qu'un agent ne peut jamais lire ou modifier les données d'un autre compte.

export type ToolContext = {
  categories: Category[];
  accounts: { id: string; name: string; space: Space }[];
  // Garde serveur (revue D4) : vrai seulement si le message actuel de l'utilisateur confirme explicitement.
  userConfirmed: boolean;
  // Espace actif et date locale de l'utilisateur (ticket #1).
  space: SpaceFilter;
  today: string;
  // Comptes de l'espace actif ; undefined quand le filtre est « Tout ».
  accountIds?: string[];
  // Écritures déjà faites pendant cette question : un modèle qui rappelle l'outil ne double rien.
  written: Set<string>;
};

const DELETE_REFUSED = {
  refus:
    "Suppression non effectuée : l'utilisateur n'a pas confirmé dans son dernier message. " +
    "Rappelle-lui précisément ce qui sera supprimé et demande « Je supprime ? ».",
};

// Lu une fois par question : les noms de catégories et de comptes deviennent des listes
// fermées dans les schémas, le modèle ne peut pas en inventer.
export async function loadToolContext(
  supabase: Supabase,
  userConfirmed: boolean,
  opts: { space?: SpaceFilter; today?: string } = {},
): Promise<ToolContext> {
  const space = opts.space ?? "all";
  const [categories, accounts] = await Promise.all([getCategories(supabase), getAccounts(supabase)]);
  return {
    categories,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, space: a.space })),
    userConfirmed,
    space,
    today: opts.today ?? new Date().toISOString().slice(0, 10),
    accountIds: space === "all" ? undefined : accounts.filter((a) => a.space === space).map((a) => a.id),
    written: new Set(),
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format AAAA-MM-JJ");
const month = z.string().regex(/^\d{4}-\d{2}$/, "format AAAA-MM");
const period = z.enum(["weekly", "monthly", "quarterly", "yearly"]);
const confirmation = z
  .literal(true)
  .describe("Mets true UNIQUEMENT si l'utilisateur a explicitement confirmé cette suppression dans la conversation.");

const spaceParam = z.enum(["perso", "pro"]).optional().describe("Par défaut : l'espace actif");

function oneOf(values: string[], fallbackDescription: string) {
  return values.length > 0 ? z.enum(values as [string, ...string[]]) : z.string().describe(fallbackDescription);
}

function resolver(ctx: ToolContext) {
  const byName = new Map(ctx.categories.map((c) => [c.name.toLowerCase(), c]));
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  const accountByName = new Map(ctx.accounts.map((a) => [a.name.toLowerCase(), a.id]));
  return {
    nameOf: (id: string | null) => (id ? (byId.get(id)?.name ?? "?") : "Non catégorisé"),
    idOf: (name: string | undefined) => (name ? byName.get(name.toLowerCase().trim())?.id : undefined),
    // Sans compte précisé : le premier compte de l'espace actif (ou perso si « Tout »).
    accountOf: (name: string | undefined) =>
      (name ? accountByName.get(name.toLowerCase().trim()) : undefined) ??
      ctx.accounts.find((a) => a.space === defaultSpace(ctx.space))?.id ??
      ctx.accounts[0]?.id ??
      null,
  };
}

// ---------------------------------------------------------------------------
// Socle commun : tout agent peut noter une dépense, une tâche ou un souvenir.
// ---------------------------------------------------------------------------

function sharedTools(supabase: Supabase, agent: AgentId, ctx: ToolContext): ToolSet {
  const r = resolver(ctx);
  const categoryName = oneOf(ctx.categories.map((c) => c.name), "Nom de catégorie");
  const accountName = oneOf(ctx.accounts.map((a) => a.name), "Nom du compte");

  return {
    ajouter_operations: tool({
      description:
        "Enregistre une ou plusieurs opérations dictées par l'utilisateur (dépenses ou revenus), en un seul appel. " +
        "Ex. : « 12 € de pain hier et 40 € d'essence » = 2 opérations. Convertis les dates relatives en AAAA-MM-JJ. " +
        "Choisis la catégorie la plus probable ; si rien ne correspond, laisse vide.",
      inputSchema: z.object({
        operations: z
          .array(
            z.object({
              libelle: z.string().min(1).describe("Commerçant ou description courte, ex. « Boulangerie Paul »"),
              montant: z.number().positive().describe("Montant positif, en euros"),
              sens: z.enum(["depense", "revenu"]),
              date: isoDate.optional().describe("Par défaut : aujourd'hui"),
              categorie: categoryName.optional(),
              compte: accountName.optional().describe("Par défaut : le compte principal"),
            }),
          )
          .min(1)
          .max(30),
      }),
      execute: async ({ operations }) => {
        const added = [];
        const skipped = [];
        for (const op of operations) {
          const key = `op|${op.libelle.trim().toLowerCase()}|${op.montant}|${op.sens}|${op.date ?? ctx.today}`;
          if (ctx.written.has(key)) {
            skipped.push(op.libelle);
            continue;
          }
          ctx.written.add(key);
          const res = await addManualTransaction(supabase, {
            accountId: r.accountOf(op.compte),
            bookedAt: op.date ?? ctx.today,
            amount: (op.sens === "depense" ? -1 : 1) * Math.abs(op.montant),
            label: op.libelle,
            categoryId: r.idOf(op.categorie) ?? null,
            categorizedBy: "llm",
          });
          added.push({ id: res.id, libelle: op.libelle, montant: op.montant, sens: op.sens, date: op.date ?? ctx.today, categorie: r.nameOf(res.categoryId) });
        }
        return {
          ajoutees: added.length,
          operations: added,
          ...(skipped.length ? { deja_enregistrees: skipped, note: "Déjà enregistrées plus tôt dans cette réponse : ne pas les rajouter." } : {}),
        };
      },
    }),
    rechercher_operations: tool({
      description: "Cherche des opérations (pour en retrouver une à modifier ou supprimer, ou répondre à une question).",
      inputSchema: z.object({
        recherche: z.string().optional().describe("Texte dans le libellé ou le commerçant"),
        du: isoDate.optional(),
        au: isoDate.optional(),
        categorie: categoryName.optional(),
        non_categorisees: z.boolean().optional(),
        limite: z.number().int().min(1).max(100).default(20),
      }),
      execute: async (a) => {
        const txs = await listTransactions(supabase, {
          accountIds: ctx.accountIds,
          from: a.du,
          to: a.au,
          categoryId: r.idOf(a.categorie),
          search: a.recherche,
          uncategorized: a.non_categorisees,
          limit: a.limite,
        });
        return txs.map((t) => ({ id: t.id, date: t.booked_at, montant: t.amount, libelle: t.label_raw, categorie: r.nameOf(t.category_id) }));
      },
    }),
    modifier_operation: tool({
      description: "Corrige une opération existante (date, montant, sens, libellé). Retrouve d'abord son id avec rechercher_operations.",
      inputSchema: z.object({
        id: z.string().uuid(),
        date: isoDate.optional(),
        montant: z.number().positive().optional(),
        sens: z.enum(["depense", "revenu"]).optional(),
        libelle: z.string().optional(),
      }),
      execute: async (a) => {
        const current = await getTransaction(supabase, a.id);
        if (!current) return { erreur: "Opération introuvable" };
        let amount: number | undefined;
        if (a.montant != null || a.sens) {
          const sign = a.sens ? (a.sens === "depense" ? -1 : 1) : current.amount > 0 ? 1 : -1;
          amount = sign * (a.montant ?? Math.abs(current.amount));
        }
        const t = await updateTransaction(supabase, a.id, { bookedAt: a.date, amount, label: a.libelle });
        return { id: t.id, date: t.booked_at, montant: Number(t.amount), libelle: t.label_raw };
      },
    }),
    supprimer_operation: tool({
      description:
        "Supprime une opération. Demande TOUJOURS confirmation à l'utilisateur avant (en rappelant date, libellé, montant), puis appelle cet outil seulement après son accord.",
      inputSchema: z.object({ id: z.string().uuid(), confirmation_utilisateur: confirmation }),
      execute: async ({ id }) => {
        if (!ctx.userConfirmed) return DELETE_REFUSED;
        await deleteTransaction(supabase, id);
        return { supprimee: id };
      },
    }),
    creer_taches: tool({
      description: "Crée une ou plusieurs tâches (démarches, rappels). Convertis les dates relatives en AAAA-MM-JJ.",
      inputSchema: z.object({
        taches: z
          .array(
            z.object({
              titre: z.string().min(1),
              description: z.string().optional(),
              priorite: z.enum(["low", "medium", "high"]).default("medium"),
              echeance: isoDate.optional(),
              espace: spaceParam,
            }),
          )
          .min(1)
          .max(20),
      }),
      execute: async ({ taches }) => {
        const created = [];
        for (const t of taches) {
          const key = `task|${t.titre.trim().toLowerCase()}|${t.echeance ?? ""}`;
          if (ctx.written.has(key)) continue;
          ctx.written.add(key);
          const task = await createTask(supabase, {
            title: t.titre,
            description: t.description,
            priority: t.priorite,
            dueDate: t.echeance,
            createdBy: "agent",
            space: t.espace ?? defaultSpace(ctx.space),
          });
          created.push({ id: task.id, titre: task.title, echeance: task.due_date });
        }
        return { creees: created };
      },
    }),
    memoriser: tool({
      description:
        "Mémorise durablement un fait ou une préférence de l'utilisateur (ex. « mon loyer part le 5 », « je garde Spotify »).",
      inputSchema: z.object({
        fait: z.string().min(3).describe("Le fait, formulé à la 3e personne"),
        partager: z.boolean().default(false).describe("true si utile à tous les agents"),
      }),
      execute: async ({ fait, partager }) => {
        await rememberFact(supabase, partager ? "shared" : agent, fait);
        return { ok: true };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

function financeTools(supabase: Supabase, ctx: ToolContext): ToolSet {
  const r = resolver(ctx);
  const categoryName = oneOf(ctx.categories.map((c) => c.name), "Nom de catégorie");

  return {
    resume_mois: tool({
      description: "Revenus, dépenses, solde net et dépenses par catégorie pour un mois.",
      inputSchema: z.object({ mois: month.optional().describe("AAAA-MM, mois courant par défaut") }),
      execute: async ({ mois }) => monthSummary(supabase, mois ?? ctx.today.slice(0, 7), ctx.accountIds),
    }),
    comparer_mois: tool({
      description: "Compare deux mois catégorie par catégorie (ex. ce mois-ci contre le précédent).",
      inputSchema: z.object({ mois_a: month, mois_b: month }),
      execute: async ({ mois_a, mois_b }) => {
        const [a, b] = await Promise.all([monthSummary(supabase, mois_a, ctx.accountIds), monthSummary(supabase, mois_b, ctx.accountIds)]);
        const names = new Set([...a.byCategory, ...b.byCategory].map((c) => c.name));
        const totalOf = (s: typeof a, n: string) => s.byCategory.find((c) => c.name === n)?.total ?? 0;
        return {
          [mois_a]: { revenus: a.income, depenses: a.expenses },
          [mois_b]: { revenus: b.income, depenses: b.expenses },
          par_categorie: [...names]
            .map((n) => ({ categorie: n, [mois_a]: totalOf(a, n), [mois_b]: totalOf(b, n), ecart: Math.round((totalOf(b, n) - totalOf(a, n)) * 100) / 100 }))
            .sort((x, y) => Math.abs(y.ecart) - Math.abs(x.ecart)),
        };
      },
    }),
    top_commercants: tool({
      description: "Commerçants où l'utilisateur dépense le plus sur une période.",
      inputSchema: z.object({ du: isoDate.optional(), au: isoDate.optional(), limite: z.number().int().min(1).max(30).default(10) }),
      execute: async ({ du, au, limite }) => {
        const from = du ?? monthRange(ctx.today.slice(0, 7)).from;
        return rankMerchants(await listTransactions(supabase, { from, to: au, limit: 5000, accountIds: ctx.accountIds }), limite);
      },
    }),
    categoriser_operation: tool({
      description:
        "Change la catégorie d'une opération. Kaobase retient ce choix pour toutes les opérations du même commerçant.",
      inputSchema: z.object({ id: z.string().uuid(), categorie: categoryName }),
      execute: async ({ id, categorie }) => {
        const categoryId = r.idOf(categorie);
        if (!categoryId) return { erreur: `Catégorie inconnue : ${categorie}` };
        return setTransactionCategory(supabase, id, categoryId);
      },
    }),
    creer_categorie: tool({
      description: "Crée une nouvelle catégorie quand aucune existante ne convient.",
      inputSchema: z.object({
        nom: z.string().min(1).max(40),
        type: z.enum(["expense", "income", "transfer"]).describe("expense = dépense, income = revenu, transfer = virement interne"),
      }),
      execute: async ({ nom, type }) => {
        const c = await createCategory(supabase, { name: nom, kind: type });
        return { creee: c.name };
      },
    }),
    creer_compte: tool({
      description: "Ajoute un compte (courant, épargne, carte, espèces).",
      inputSchema: z.object({
        nom: z.string().min(1),
        type: z.enum(["checking", "savings", "card", "cash", "other"]).default("checking"),
        solde_initial: z.number().default(0),
        espace: spaceParam,
      }),
      execute: async (a) =>
        createAccount(supabase, { name: a.nom, kind: a.type, openingBalance: a.solde_initial, space: a.espace ?? defaultSpace(ctx.space) }),
    }),
    soldes: tool({
      description: "Solde actuel de chaque compte et solde total.",
      inputSchema: z.object({}),
      execute: async () => {
        const accounts = await getAccounts(supabase, ctx.space);
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
          getTotalBalance(supabase, ctx.space),
          listSubscriptions(supabase, ["active"], ctx.space),
          listTransactions(supabase, { from: since.toISOString().slice(0, 10), limit: 5000, accountIds: ctx.accountIds }),
        ]);
        const result = forecastBalance({
          today: ctx.today,
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
    definir_budget: tool({
      description: "Fixe (ou change) le budget mensuel d'une catégorie.",
      inputSchema: z.object({ categorie: categoryName, montant_mensuel: z.number().positive() }),
      execute: async ({ categorie, montant_mensuel }) => {
        const id = r.idOf(categorie);
        if (!id) return { erreur: `Catégorie inconnue : ${categorie}` };
        await setBudget(supabase, id, montant_mensuel);
        return { budget: categorie, montant_mensuel };
      },
    }),
    supprimer_budget: tool({
      description: "Retire le budget d'une catégorie.",
      inputSchema: z.object({ categorie: categoryName }),
      execute: async ({ categorie }) => {
        const id = r.idOf(categorie);
        if (!id) return { erreur: `Catégorie inconnue : ${categorie}` };
        await deleteBudget(supabase, id);
        return { supprime: categorie };
      },
    }),
    suivi_budgets: tool({
      description: "Où en est chaque budget ce mois-ci (dépensé, reste, pourcentage).",
      inputSchema: z.object({ mois: month.optional() }),
      execute: async ({ mois }) => (await budgetStatus(supabase, mois ?? ctx.today.slice(0, 7), ctx.accountIds)) ?? { erreur: BUDGETS_MISSING },
    }),
  };
}

// ---------------------------------------------------------------------------
// Abonnements
// ---------------------------------------------------------------------------

function subscriptionTools(supabase: Supabase, ctx: ToolContext): ToolSet {
  const r = resolver(ctx);
  return {
    lister_abonnements: tool({
      description: "Abonnements suivis, avec coût mensuel et annuel. « suggested » = détecté, à confirmer.",
      inputSchema: z.object({ statut: z.enum(["active", "suggested", "cancelled", "rejected", "tous"]).default("tous") }),
      execute: async ({ statut }) => {
        const subs = await listSubscriptions(supabase, statut === "tous" ? ["active", "suggested", "cancelled"] : [statut], ctx.space);
        return subs.map((s) => ({
          id: s.id,
          nom: s.name,
          statut: s.status,
          montant: s.amount,
          periode: s.period,
          prochaine_echeance: s.next_due,
          cout_mensuel: monthlyCost(s.amount, s.period),
          cout_annuel: annualCost(s.amount, s.period),
          categorie: r.nameOf(s.category_id),
          notes: s.notes,
        }));
      },
    }),
    cout_total_abonnements: tool({
      description: "Coût total mensuel et annuel des abonnements actifs.",
      inputSchema: z.object({}),
      execute: async () => {
        const subs = await listSubscriptions(supabase, ["active"], ctx.space);
        const mensuel = subs.reduce((s, x) => s + monthlyCost(x.amount, x.period), 0);
        return { nombre: subs.length, mensuel: Math.round(mensuel * 100) / 100, annuel: Math.round(mensuel * 12 * 100) / 100 };
      },
    }),
    pistes_economies: tool({
      description:
        "Données pour proposer des économies : abonnements classés par coût annuel, catégories où plusieurs services se cumulent, abonnements mensuels qui coûteraient moins en annuel.",
      inputSchema: z.object({}),
      execute: async () => {
        const subs = await listSubscriptions(supabase, ["active"], ctx.space);
        const byCategory = new Map<string, string[]>();
        for (const s of subs) {
          const c = r.nameOf(s.category_id);
          byCategory.set(c, [...(byCategory.get(c) ?? []), s.name]);
        }
        return {
          par_cout_annuel: subs
            .map((s) => ({ nom: s.name, cout_annuel: annualCost(s.amount, s.period), periode: s.period }))
            .sort((a, b) => b.cout_annuel - a.cout_annuel),
          cumuls_par_categorie: [...byCategory.entries()].filter(([, n]) => n.length > 1).map(([categorie, services]) => ({ categorie, services })),
          mensuels: subs.filter((s) => s.period === "monthly").map((s) => s.name),
        };
      },
    }),
    detecter_abonnements: tool({
      description: "Relance la détection des paiements récurrents sur l'historique.",
      inputSchema: z.object({}),
      execute: async () => runSubscriptionDetection(supabase),
    }),
    modifier_abonnement: tool({
      description:
        "Met à jour un abonnement : confirmer (active), rejeter une suggestion (rejected), marquer résilié (cancelled), changer montant, période, échéance, notes.",
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
      description: "Ajoute un abonnement que l'utilisateur paie (ex. « j'ai pris Disney+ à 9,99 € par mois »).",
      inputSchema: z.object({
        nom: z.string().min(1),
        montant: z.number().positive(),
        periode: period,
        prochaine_echeance: isoDate.optional(),
        espace: spaceParam,
      }),
      execute: async (a) =>
        createSubscription(supabase, {
          name: a.nom,
          amount: a.montant,
          period: a.periode,
          nextDue: a.prochaine_echeance ?? null,
          space: a.espace ?? defaultSpace(ctx.space),
        }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Tâches
// ---------------------------------------------------------------------------

function taskTools(supabase: Supabase, ctx: ToolContext): ToolSet {
  return {
    lister_taches: tool({
      description: "Tâches de l'utilisateur, triées par échéance.",
      inputSchema: z.object({ statut: z.enum(["todo", "doing", "done", "ouvertes"]).default("ouvertes") }),
      execute: async ({ statut }) => {
        const tasks = await listTasks(supabase, statut === "ouvertes" ? ["todo", "doing"] : [statut], ctx.space);
        return tasks.map((t) => ({ id: t.id, titre: t.title, statut: t.status, priorite: t.priority, echeance: t.due_date, description: t.description }));
      },
    }),
    modifier_tache: tool({
      description: "Modifie une tâche (statut, priorité, échéance, titre). « C'est fait » = statut done.",
      inputSchema: z.object({
        id: z.string().uuid(),
        statut: z.enum(["todo", "doing", "done"]).optional(),
        priorite: z.enum(["low", "medium", "high"]).optional(),
        echeance: isoDate.optional(),
        titre: z.string().optional(),
      }),
      execute: async (a) => updateTask(supabase, a.id, { status: a.statut, priority: a.priorite, due_date: a.echeance, title: a.titre }),
    }),
    supprimer_tache: tool({
      description: "Supprime une tâche. Demande confirmation à l'utilisateur avant.",
      inputSchema: z.object({ id: z.string().uuid(), confirmation_utilisateur: confirmation }),
      execute: async ({ id }) => {
        if (!ctx.userConfirmed) return DELETE_REFUSED;
        await deleteTask(supabase, id);
        return { supprimee: id };
      },
    }),
    planifier_rappels_abonnements: tool({
      description: "Crée une tâche de vérification pour chaque abonnement prélevé dans les N prochains jours.",
      inputSchema: z.object({ jours: z.number().int().min(1).max(60).default(7) }),
      execute: async ({ jours }) => {
        const created = await planSubscriptionReminders(supabase, jours, ctx.space);
        return { creees: created.map((t) => ({ titre: t.title, echeance: t.due_date })) };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

function importTools(supabase: Supabase, ctx: ToolContext): ToolSet {
  return {
    historique_imports: tool({
      description: "Derniers imports de relevés (lignes ajoutées, déjà présentes, illisibles).",
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
      description: "Contrôle qualité : opérations sans catégorie, part triée par règles/IA/utilisateur, commerçants à traiter en priorité.",
      inputSchema: z.object({}),
      execute: async () => {
        const txs = await listTransactions(supabase, { limit: 5000, accountIds: ctx.accountIds });
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
          operations_analysees: txs.length,
          categorisation: by,
          commercants_sans_categorie: [...pending.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([commercant, n]) => ({ commercant, operations: n })),
        };
      },
    }),
    categoriser_non_classees: tool({
      description: "Trie toutes les opérations sans catégorie (règles apprises puis IA).",
      inputSchema: z.object({}),
      execute: async () => categorizeTransactions(supabase, await listTransactions(supabase, { uncategorized: true, limit: 1000, accountIds: ctx.accountIds })),
    }),
    detecter_abonnements: tool({
      description: "Relance la détection des paiements récurrents sur l'historique.",
      inputSchema: z.object({}),
      execute: async () => runSubscriptionDetection(supabase),
    }),
  };
}

export function toolsFor(agent: AgentId, supabase: Supabase, ctx: ToolContext): ToolSet {
  const specific = {
    finance: () => financeTools(supabase, ctx),
    subscriptions: () => subscriptionTools(supabase, ctx),
    tasks: () => taskTools(supabase, ctx),
    imports: () => importTools(supabase, ctx),
  }[agent]();
  return { ...sharedTools(supabase, agent, ctx), ...specific };
}
