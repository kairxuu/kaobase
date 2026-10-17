import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];

// Rafraîchit le jeton Supabase à chaque requête et redirige les visiteurs non connectés.
// Vérification « optimiste » : l'autorisation réelle reste la RLS côté base.
export async function updateSession(request: NextRequest) {
  // Native clients authenticate in the mobile route with a verified bearer token.
  // They do not share the browser's cookie jar.
  if (request.nextUrl.pathname.startsWith("/api/mobile/")) return NextResponse.next({ request });
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.redirect(url);
  }
  if (data?.claims && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
