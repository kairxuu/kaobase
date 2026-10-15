import { expect, test } from "@playwright/test";

test("la page de connexion s'affiche", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /au même endroit/ })).toBeVisible();
});

test("les pages privées renvoient vers la connexion", async ({ page }) => {
  for (const path of ["/", "/transactions", "/settings", "/agents"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("mot de passe oublié : formulaire et réponse neutre", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Mot de passe oublié ?" }).click();
  await expect(page.getByRole("heading", { name: "Mot de passe oublié" })).toBeVisible();
  await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Revenir à la connexion" }).click();
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
});

test("lien expiré : message clair", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=invalide&type=recovery");
  await expect(page).toHaveURL(/lien=expire/);
  await expect(page.getByText("Ce lien n'est plus valable")).toBeVisible();
});

test("l'API des agents refuse sans session", async ({ request }) => {
  const res = await request.post("/api/agents", {
    data: { message: "test", conversationId: "00000000-0000-4000-8000-000000000000" },
  });
  expect(res.status()).toBe(401);
});
