import "server-only";
import { PostgrestClient } from "@supabase/postgrest-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return value;
}

export function databaseProvider(): "supabase" | "neon" {
  const provider = process.env.DATABASE_PROVIDER ?? "supabase";
  if (provider !== "supabase" && provider !== "neon") throw new Error("DATABASE_PROVIDER doit être supabase ou neon.");
  return provider;
}

/** Keep Supabase Auth; Neon validates its signed JWT and enforces the restored RLS. */
export function createNeonDataClient(accessToken: () => Promise<string | null>) {
  const url = new URL(required("NEON_DATA_API_URL"));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("NEON_DATA_API_URL doit être l'adresse HTTPS du service Data API, sans identifiants.");
  }
  return new PostgrestClient(url.href.replace(/\/$/, ""), {
    fetch: async (input, init) => {
      const token = await accessToken();
      if (!token) return Response.json({ code: "PGRST301", message: "Session requise." }, { status: 401 });
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      headers.delete("apikey");
      return fetch(input, { ...init, headers, cache: "no-store", redirect: "error" });
    },
  });
}
