import { expect, test as setup } from "@playwright/test";

setup("connexion du compte de test", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Mot de passe", { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: /Bonjour|Fais comme chez toi/ })).toBeVisible();
  // Un compte de test configuré poursuit directement ; sinon son premier login
  // traverse le même parcours que toute nouvelle inscription, sans créer de doublon.
  if (await page.getByRole("heading", { name: "Fais comme chez toi." }).isVisible()) {
    const name = page.getByRole("textbox", { name: "Comment veux-tu qu'on t'appelle ?" });
    if (!(await name.inputValue()).trim()) await name.fill("Testeur");
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.getByRole("button", { name: "Ouvrir mon tableau de bord" }).click();
  }
  await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
  await page.context().storageState({ path: "tests/e2e/.auth/user.json" });
});
