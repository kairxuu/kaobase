import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Parcours connectés sur le compte de test. Contrat de non-régression (revue D8) :
// (1) recatégoriser propage la catégorie, (2) ré-import sans doublon, (3) abonnements détectés sur le relevé de démo,
// (4) toutes les pages s'affichent sans erreur, (5) la dictée de 3 opérations à l'agent crée 3 lignes.
// Les tests laissent le compte propre : ce qu'ils créent, ils le suppriment.

test.describe.configure({ mode: "serial" });

const DEMO = path.join(process.cwd(), "demo", "releve-demo.csv");
const PAGES = ["/", "/transactions", "/subscriptions", "/tasks", "/import", "/agents", "/agents/performance", "/settings"];

function acceptDialogs(page: Page) {
  page.on("dialog", (d) => d.accept());
}

async function importDemo(page: Page) {
  // networkidle : la page est hydratée avant de choisir le fichier.
  await page.goto("/import", { waitUntil: "networkidle" });
  await page.getByLabel("Relevé (CSV ou OFX)").setInputFiles(DEMO);
  await expect(page.getByText(/Kaobase a reconnu les colonnes/)).toBeVisible();
  await page.getByRole("button", { name: "Importer le relevé" }).click();
  return page.getByRole("status").filter({ hasText: "opérations ajoutées" });
}

test("(4) chaque page s'affiche sans erreur", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const p of PAGES) {
    await page.goto(p);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.getByText(/This page couldn.t load|Application error/)).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("(2) import puis ré-import sans doublon, (3) abonnements proposés", async ({ page }) => {
  const first = await importDemo(page);
  await expect(first).toBeVisible({ timeout: 60_000 });
  await expect(first).toContainText(/\d+ opérations ajoutées/);

  const second = await importDemo(page);
  await expect(second).toContainText("0 opérations ajoutées", { timeout: 60_000 });
  await expect(second).toContainText("déjà là");

  await page.goto("/subscriptions");
  // count() n'attend pas : on attend d'abord que la section des propositions soit affichée.
  await expect(page.getByRole("heading", { name: /reviennent régulièrement/ })).toBeVisible();
  const suggestions = page.getByRole("button", { name: "Oui, le suivre" });
  expect(await suggestions.count()).toBeGreaterThanOrEqual(5);
});

test("(1) recatégoriser une opération l'applique aux autres du même commerçant", async ({ page }) => {
  await page.goto("/transactions?q=NETFLIX");
  // Menus des lignes du tableau (le premier menu « Catégorie » de la page est le filtre de recherche).
  const rowSelects = () => page.locator("tbody").getByRole("combobox", { name: "Catégorie" });
  const selects = rowSelects();
  await expect(selects.first()).toBeVisible();
  expect(await selects.count()).toBeGreaterThanOrEqual(3);
  await selects.first().selectOption({ label: "Loisirs" });
  await expect(page.getByText(/appliqué à \d+ autres?/)).toBeVisible();
  await page.reload();
  const values = await rowSelects().evaluateAll((els) =>
    els.map((el) => (el as HTMLSelectElement).selectedOptions[0]?.text),
  );
  expect(values.every((v) => v === "Loisirs")).toBe(true);
  // Remet la catégorie d'origine pour les prochains passages.
  await rowSelects().first().selectOption({ label: "Abonnements" });
  await expect(page.getByText(/appliqué à \d+ autres?/)).toBeVisible();
});

test("opération : ajouter, modifier, supprimer (F7)", async ({ page }) => {
  acceptDialogs(page);
  // Restes d'un passage interrompu : on repart d'un compte propre.
  await page.goto("/transactions?q=E2E%20Librairie");
  const leftovers = page.locator("tbody").getByRole("row").filter({ hasText: "E2E Librairie" });
  while ((await leftovers.count()) > 0) {
    const before = await leftovers.count();
    await leftovers.first().getByRole("button", { name: "Supprimer" }).click();
    await expect(leftovers).toHaveCount(before - 1);
  }

  const label = `E2E Librairie ${Date.now()}`;
  await page.goto("/transactions");
  await page.getByText("Ajouter une opération à la main").click();
  await page.locator("#label").fill(label);
  await page.locator("#amount").fill("9,90");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  // Le formulaire se vide quand l'action a réussi : on attend avant de changer de page.
  await expect(page.locator("#label")).toHaveValue("");
  await page.goto(`/transactions?q=${encodeURIComponent(label)}`);
  const row = page.locator("tbody").getByRole("row").filter({ hasText: label });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Modifier" }).click();
  await row.getByLabel("Montant").fill("12,30");
  await row.getByRole("button", { name: "Enregistrer" }).click();
  await expect(row).toContainText("12,30");
  await row.getByRole("button", { name: "Supprimer" }).click();
  await expect(page.locator("tbody").getByRole("row").filter({ hasText: label })).toHaveCount(0);
});

test("catégorie : créer, doublon refusé clairement, renommer, supprimer (F8, R5)", async ({ page }) => {
  acceptDialogs(page);
  await page.goto("/settings", { waitUntil: "networkidle" });
  // Limité à la carte Catégories : les catégories de dépense apparaissent aussi dans les budgets.
  const card = page.locator("#categories");
  // En mode édition, le nom passe dans un champ : on cible l'éditeur ouvert (un seul à la fois).
  const editor = () => card.getByRole("listitem").filter({ has: page.getByLabel("Nom de la catégorie") });
  // Restes d'un passage interrompu.
  for (const name of ["E2E Voyage", "E2E Vacances"]) {
    const leftover = card.getByRole("listitem").filter({ hasText: name });
    if ((await leftover.count()) > 0) {
      await leftover.first().getByRole("button", { name: "Modifier" }).click();
      await editor().getByRole("button", { name: "Supprimer la catégorie" }).click();
      await expect(card.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
    }
  }
  const add = async () => {
    await page.getByText("Ajouter une catégorie").click();
    await page.locator("#cat-name").fill("E2E Voyage");
    await page.getByRole("button", { name: "Ajouter la catégorie" }).click();
  };
  await add();
  await expect(card.getByRole("listitem").filter({ hasText: "E2E Voyage" })).toBeVisible();
  await page.locator("#cat-name").fill("E2E Voyage");
  await page.getByRole("button", { name: "Ajouter la catégorie" }).click();
  await expect(page.getByText("Cette catégorie existe déjà.")).toBeVisible();

  await card.getByRole("listitem").filter({ hasText: "E2E Voyage" }).getByRole("button", { name: "Modifier" }).click();
  await editor().getByLabel("Nom de la catégorie").fill("E2E Vacances");
  await editor().getByRole("button", { name: "Enregistrer" }).click();
  // L'éditeur se referme quand l'enregistrement a réussi.
  await expect(editor()).toHaveCount(0);
  const renamed = card.getByRole("listitem").filter({ hasText: "E2E Vacances" });
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: "Modifier" }).click();
  await editor().getByRole("button", { name: "Supprimer la catégorie" }).click();
  await expect(card.getByRole("listitem").filter({ hasText: "E2E Vacances" })).toHaveCount(0);
});

test("profil : nom et avatar visibles dans la barre latérale, quota IA affiché", async ({ page }) => {
  await page.goto("/settings", { waitUntil: "networkidle" });
  const sidebar = page.getByRole("complementary").first();
  await expect(sidebar.getByText("Agents IA, 24 h")).toBeVisible();
  await expect(sidebar.getByRole("meter", { name: /Questions posées aux agents/ })).toBeVisible();

  const original = { first: await page.locator("#firstName").inputValue(), last: await page.locator("#lastName").inputValue() };
  const save = async (first: string, last: string) => {
    await page.locator("#firstName").fill(first);
    await page.locator("#lastName").fill(last);
    await page.getByRole("button", { name: "Enregistrer le profil" }).click();
    await expect(page.getByText("Profil enregistré.")).toBeVisible();
  };
  await save("Testeur", "Kaobase");
  await page.reload();
  await expect(sidebar.getByText("Testeur Kaobase")).toBeVisible();
  await save(original.first, original.last);
});

test("espaces perso/pro : filtre global mémorisé (ticket #1)", async ({ page }) => {
  acceptDialogs(page);
  const switcher = page.getByRole("radiogroup", { name: "Espace affiché" });
  const pick = async (label: "Tout" | "Perso" | "Pro") => {
    await switcher.getByRole("radio", { name: label }).click();
    await expect(switcher.getByRole("radio", { name: label })).toHaveAttribute("aria-checked", "true");
  };
  const label = `E2E Pro Achat ${Date.now()}`;

  // Compte pro (ou réutilisé s'il reste d'un passage interrompu).
  await page.goto("/settings", { waitUntil: "networkidle" });
  await pick("Tout");
  if ((await page.getByText("E2E Pro", { exact: true }).count()) === 0) {
    await page.getByText("Ajouter un compte").click();
    await page.locator("#acc-name").fill("E2E Pro");
    await page.locator("#acc-space").selectOption("pro");
    await page.getByRole("button", { name: "Ajouter le compte" }).click();
    await expect(page.getByText("Compte ajouté.")).toBeVisible();
  }

  // Une opération sur ce compte.
  await page.goto("/transactions", { waitUntil: "networkidle" });
  await page.getByText("Ajouter une opération à la main").click();
  await page.locator("#label").fill(label);
  await page.locator("#amount").fill("4,20");
  await page.locator("#accountId").selectOption({ label: "E2E Pro" });
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.locator("#label")).toHaveValue("");

  const rows = () => page.locator("tbody").getByRole("row").filter({ hasText: label });
  const search = `/transactions?q=${encodeURIComponent(label)}`;

  await pick("Pro");
  await page.goto(search);
  await expect(page.getByRole("status").filter({ hasText: "Espace Pro" })).toBeVisible();
  await expect(rows()).toHaveCount(1);

  await pick("Perso");
  await page.goto(search);
  await expect(rows()).toHaveCount(0);

  // Le choix survit au rechargement.
  await page.reload();
  await expect(switcher.getByRole("radio", { name: "Perso" })).toHaveAttribute("aria-checked", "true");

  await pick("Tout");
  await page.goto(search);
  await expect(rows()).toHaveCount(1);

  // Nettoyage : l'opération puis le compte pro.
  await rows().first().getByRole("button", { name: "Supprimer" }).click();
  await expect(rows()).toHaveCount(0);
  await page.goto("/settings", { waitUntil: "networkidle" });
  const account = page.getByRole("listitem").filter({ hasText: "E2E Pro" });
  await account.getByRole("button", { name: "Modifier" }).click();
  await page.getByRole("button", { name: "Supprimer le compte et ses opérations" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "E2E Pro" })).toHaveCount(0);
});

test("devise appliquée partout (R4)", async ({ page }) => {
  const setCurrency = async (code: string) => {
    await page.goto("/settings");
    await page.locator("#currency").selectOption(code);
    await page.locator("section").first().getByRole("button", { name: "Enregistrer" }).first().click();
    // Attend que la valeur soit enregistrée en base (relue après rechargement).
    await expect(async () => {
      await page.reload();
      await expect(page.locator("#currency")).toHaveValue(code, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
  };
  await setCurrency("USD");
  await page.goto("/");
  await expect(page.getByText(/\$/).first()).toBeVisible();
  await setCurrency("EUR");
  await page.goto("/");
  await expect(page.getByText(/€/).first()).toBeVisible();
});

test("budget : fixer, afficher, retirer (F9)", async ({ page }) => {
  await page.goto("/settings#budgets", { waitUntil: "networkidle" });
  const budgets = page.locator("#budgets");
  const row = budgets.getByRole("listitem").filter({ hasText: "Alimentation" });
  await row.getByRole("button", { name: "Modifier" }).click();
  await budgets.getByLabel(/Budget mensuel pour Alimentation/).fill("300");
  await budgets.getByRole("button", { name: "Enregistrer le budget" }).click();
  await expect(row).toContainText("sur 300,00");
  await page.goto("/");
  await expect(page.getByText(/sur 300,00/).first()).toBeVisible();
  await page.goto("/settings#budgets", { waitUntil: "networkidle" });
  await row.getByRole("button", { name: "Modifier" }).click();
  await budgets.getByRole("button", { name: "Retirer le budget" }).click();
  await expect(row).toContainText("sans budget");
});

test("tâche : créer, modifier, supprimer (F15)", async ({ page }) => {
  acceptDialogs(page);
  await page.goto("/tasks");
  await page.getByText("Ajouter une tâche").click();
  await page.locator("#title").fill("E2E appeler la banque");
  await page.getByRole("button", { name: "Ajouter la tâche" }).click();
  const card = page.getByRole("listitem").filter({ hasText: "E2E appeler la banque" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Modifier" }).click();
  await card.getByLabel("Titre").fill("E2E rappeler la banque");
  await card.getByRole("button", { name: "Enregistrer" }).click();
  const edited = page.getByRole("listitem").filter({ hasText: "E2E rappeler la banque" });
  await expect(edited).toBeVisible();
  await edited.getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "E2E rappeler la banque" })).toHaveCount(0);
});

test("(5) dictée de 3 opérations à l'agent", async ({ page }) => {
  acceptDialogs(page);
  test.setTimeout(150_000);
  await page.goto("/agents");
  await page.getByLabel("Message").fill(
    "J'ai payé 1,11 € chez E2E Alpha, 2,22 € chez E2E Beta et 3,33 € chez E2E Gamma aujourd'hui",
  );
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText(/a enregistré des opérations/)).toBeVisible({ timeout: 120_000 });

  await page.goto("/transactions?q=E2E");
  const rows = page.getByRole("row").filter({ hasText: /E2E (Alpha|Beta|Gamma)/ });
  await expect(rows).toHaveCount(3);
  // Nettoyage.
  for (let i = 0; i < 3; i++) {
    await page.getByRole("row").filter({ hasText: /E2E (Alpha|Beta|Gamma)/ }).first().getByRole("button", { name: "Supprimer" }).click();
    await expect(page.getByRole("row").filter({ hasText: /E2E (Alpha|Beta|Gamma)/ })).toHaveCount(2 - i);
  }

  // La conversation apparaît dans l'historique (F12).
  await page.goto("/agents");
  await expect(page.getByRole("complementary").getByText(/E2E Alpha/).first()).toBeVisible();
});

test("annuler l'import retire ses opérations (F11)", async ({ page }) => {
  acceptDialogs(page);
  test.setTimeout(180_000);
  const undo = page.getByRole("button", { name: "Annuler cet import" });
  const openImports = async () => {
    await page.goto("/import", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Relevés déjà importés" })).toBeVisible();
    return undo.count();
  };
  let remaining = await openImports();
  expect(remaining).toBeGreaterThan(0);
  while (remaining > 0) {
    await undo.first().click();
    // La ligne de l'import disparaît du tableau quand l'annulation a réussi.
    await expect(undo).toHaveCount(remaining - 1);
    remaining = await openImports();
  }
  await page.goto("/transactions?q=NETFLIX");
  await expect(page.getByText("Aucune opération ne correspond")).toBeVisible();
});
