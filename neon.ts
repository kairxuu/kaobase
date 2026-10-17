import { defineConfig } from "@neon/config/v1";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) throw new Error("Charge .env.local pour évaluer neon.ts (NEXT_PUBLIC_SUPABASE_URL requise).");

export default defineConfig({
  // Preserve the existing Supabase identities and validate their JWTs in Neon.
  auth: false,
  dataApi: {
    authProvider: "external",
    providerName: "Supabase",
    jwksUrl: new URL("/auth/v1/.well-known/jwks.json", supabaseUrl).href,
    jwtAudience: "authenticated",
    settings: { dbSchemas: ["public"], dbMaxRows: 1000, jwtRoleClaimKey: ".role", openapiMode: "disabled" },
  },
  branch: (branch) => {
    if (!branch.isDefault && !branch.exists) {
      // Data API currently rejects branches with an expiration date.
      return { postgres: { computeSettings: { autoscalingLimitMinCu: 0.25, autoscalingLimitMaxCu: 1, suspendTimeout: "5m" } } };
    }
    return {};
  },
});
