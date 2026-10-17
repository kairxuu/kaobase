import path from "node:path";
import type { NextConfig } from "next";

const EMBEDDING_FILES = [
  "./node_modules/onnxruntime-node/package.json",
  "./node_modules/onnxruntime-node/dist/**",
  "./node_modules/onnxruntime-node/lib/**",
  "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
  "./node_modules/onnxruntime-common/**",
  "./node_modules/sharp/**",
  "./node_modules/@img/sharp-linux-x64/**",
  "./node_modules/@img/sharp-libvips-linux-x64/**",
];

const nextConfig: NextConfig = {
  // Let migration checks run beside the developer's existing server.
  distDir: process.env.KAOBASE_NEXT_DIST_DIR || ".next",
  // Embeddings locaux (onnxruntime) : à charger côté Node, pas à bundler.
  serverExternalPackages: ["@huggingface/transformers"],
  // onnxruntime-node est chargé dynamiquement : le traçage de Next ne le voit pas.
  // On n'embarque que le binaire Linux x64 (celui des fonctions Vercel).
  outputFileTracingIncludes: {
    "/api/agents": EMBEDDING_FILES,
    "/api/feedback": EMBEDDING_FILES,
    "/api/mobile/**": EMBEDDING_FILES,
  },
  turbopack: {
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
