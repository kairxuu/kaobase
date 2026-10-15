import { expect, test as setup } from "@playwright/test";

setup("connexion du compte de test", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env.E2E_EMAIL!);
  await page.getByLabel("Mot de passe", { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: /Bonjour/ })).toBeVisible();
  await page.context().storageState({ path: "tests/e2e/.auth/user.json" });
});
