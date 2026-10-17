import { defineConfig } from "@playwright/test";
import { loadEnv } from "vite";

// Suite de bout en bout (revue D9) : vrais parcours sur Neon, avec un compte de test dédié.
// Identifiants dans .env.test.local (jamais commité) : E2E_EMAIL, E2E_PASSWORD. Base : E2E_BASE_URL ou serveur local.
Object.assign(process.env, loadEnv("test", process.cwd(), ""));

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const hasAccount = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL, channel: "chrome", headless: true, locale: "fr-FR", trace: "retain-on-failure" },
  projects: [
    { name: "public", testMatch: /public\.spec\.ts/ },
    ...(hasAccount
      ? [
          { name: "setup", testMatch: /auth\.setup\.ts/ },
          { name: "app", testMatch: /app\.spec\.ts/, dependencies: ["setup"], use: { storageState: "tests/e2e/.auth/user.json" } },
        ]
      : []),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev -- -p 3100", url: `${baseURL}/login`, reuseExistingServer: true, timeout: 120_000 },
});
