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
  await page.goto("/transactions");
  await page.getByText("Ajouter une opération à la main").click();
  await page.locator("#label").fill("E2E Librairie");
  await page.locator("#amount").fill("9,90");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.goto("/transactions?q=E2E%20Librairie");
  const row = page.getByRole("row").filter({ hasText: "E2E Librairie" });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Modifier" }).click();
  await row.getByLabel("Montant").fill("12,30");
  await row.getByRole("button", { name: "Enregistrer" }).click();
  await expect(row).toContainText("12,30");
  await row.getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E Librairie" })).toHaveCount(0);
});

test("catégorie : créer, doublon refusé clairement, renommer, supprimer (F8, R5)", async ({ page }) => {
  acceptDialogs(page);
  await page.goto("/settings");
  const add = async () => {
    await page.getByText("Ajouter une catégorie").click();
    await page.locator("#cat-name").fill("E2E Voyage");
    await page.getByRole("button", { name: "Ajouter la catégorie" }).click();
  };
  await add();
  await expect(page.getByRole("listitem").filter({ hasText: "E2E Voyage" })).toBeVisible();
  await page.locator("#cat-name").fill("E2E Voyage");
  await page.getByRole("button", { name: "Ajouter la catégorie" }).click();
  await expect(page.getByText("Cette catégorie existe déjà.")).toBeVisible();

  const item = page.getByRole("listitem").filter({ hasText: "E2E Voyage" });
  await item.getByRole("button", { name: "Modifier" }).click();
  await item.getByLabel("Nom de la catégorie").fill("E2E Vacances");
  await item.getByRole("button", { name: "Enregistrer" }).click();
  const renamed = page.getByRole("listitem").filter({ hasText: "E2E Vacances" });
  await expect(renamed).toBeVisible();
  await renamed.getByRole("button", { name: "Modifier" }).click();
  await renamed.getByRole("button", { name: "Supprimer la catégorie" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "E2E Vacances" })).toHaveCount(0);
});

test("devise appliquée partout (R4)", async ({ page }) => {
  await page.goto("/settings");
  const profile = page.locator("section").first();
  await page.locator("#currency").selectOption("USD");
  await profile.getByRole("button", { name: "Enregistrer" }).first().click();
  await expect(profile.getByRole("button", { name: "Enregistrer" }).first()).toBeEnabled();
  await page.goto("/");
  await expect(page.getByText(/\$/).first()).toBeVisible();
  await page.goto("/settings");
  await page.locator("#currency").selectOption("EUR");
  await profile.getByRole("button", { name: "Enregistrer" }).first().click();
  await expect(profile.getByRole("button", { name: "Enregistrer" }).first()).toBeEnabled();
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
  await expect(page.getByRole("complementary").getByText(/E2E Alpha/)).toBeVisible();
});

test("annuler l'import retire ses opérations (F11)", async ({ page }) => {
  acceptDialogs(page);
  await page.goto("/import");
  const undo = page.getByRole("button", { name: "Annuler cet import" });
  while ((await undo.count()) > 0) {
    await undo.first().click();
    await expect(page.getByText(/opérations? retirées?/).first()).toBeVisible();
    await page.reload();
  }
  await page.goto("/transactions?q=NETFLIX");
  await expect(page.getByText("Aucune opération ne correspond")).toBeVisible();
});
