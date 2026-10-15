import { defineConfig, loadEnv } from "vite";
import path from "node:path";

// Évaluation des agents (revue D10) : vrai modèle Groq, base factice. Lancée à la main : npm run eval:agents
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["evals/**/*.eval.ts"],
    testTimeout: 300_000,
    fileParallelism: false,
    env: loadEnv("", process.cwd(), ""),
  },
});
