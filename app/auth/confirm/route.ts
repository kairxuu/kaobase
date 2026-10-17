import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOnboardingStatus } from "@/lib/data/onboarding";

// Lien reçu par email : confirmation d'inscription ou réinitialisation du mot de passe.
// Gère les deux formats Supabase (token_hash + type, ou code PKCE) et un paramètre `next` relatif.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "";
  // Uniquement un chemin interne : jamais de redirection vers un autre site.
  let next = /^\/(?!\/)[\w\-/]*$/.test(nextParam) ? nextParam : type === "recovery" ? "/auth/reset" : "/";
  const supabase = await createClient();

  let ok = false;
  let userId: string | undefined;
  if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
    userId = data.user?.id;
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
    userId = data.user?.id;
  }

  if (ok) {
    if (next === "/") {
      const status = userId ? await getOnboardingStatus(supabase, userId) : "pending";
      if (status !== "complete") next = "/setup";
    }
    return NextResponse.redirect(`${origin}${next}`);
  }
  const url = new URL("/login", origin);
  url.searchParams.set("lien", "expire");
  return NextResponse.redirect(url);
}
