import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Embeddings locaux (onnxruntime) : à charger côté Node, pas à bundler.
  serverExternalPackages: ["@huggingface/transformers"],
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
