import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  dataApi: {
    authProvider: "neon",
    settings: { dbSchemas: ["public"], dbMaxRows: 1000, openapiMode: "disabled" },
  },
  branch: (branch) => {
    if (!branch.isDefault && !branch.exists) {
      // Data API currently rejects branches with an expiration date.
      return { postgres: { computeSettings: { autoscalingLimitMinCu: 0.25, autoscalingLimitMaxCu: 1, suspendTimeout: "5m" } } };
    }
    return {};
  },
});
