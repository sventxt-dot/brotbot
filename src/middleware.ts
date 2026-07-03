import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

// @supabase/ssr uses Node.js APIs not available in the Edge runtime.
export const runtime = "nodejs";

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") ?? "";
  const path = request.nextUrl.pathname;
  const isAdminSubdomain = hostname.startsWith("admin.");

  // ── Admin-subdomain rewrite ──────────────────────────────────────────────
  // Requests arriving on admin.* without /admin prefix get rewritten:
  //   admin.example.com/        → serves /admin
  //   admin.example.com/login   → serves /admin/login
  if (isAdminSubdomain && !path.startsWith("/admin")) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin" + (path === "/" ? "" : path);
    return NextResponse.rewrite(url);
  }

  // ── Block /admin/* on the public domain ─────────────────────────────────
  // Any request to /admin/* that is NOT on the admin subdomain returns 404.
  // This prevents the admin UI from being reachable at brotbot.bot-boutique.com/admin/*.
  if (path.startsWith("/admin") && !isAdminSubdomain) {
    return new NextResponse(null, { status: 404 });
  }

  // ── API routes: skip auth guard, handled by each route handler ───────────
  if (path.startsWith("/api/")) {
    return NextResponse.next({ request });
  }

  // ── Supabase session refresh + admin auth guard ──────────────────────────
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // /admin/login and /admin/auth/callback are publicly accessible on admin subdomain.
  if (path.startsWith("/admin/login") || path.startsWith("/admin/auth")) {
    return supabaseResponse;
  }

  // All other /admin/* routes require a valid session.
  if (path.startsWith("/admin") && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/admin/login";
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  // Covers /admin/* for auth protection, and / + all non-asset, non-API paths
  // for the admin-subdomain hostname rewrite. Excludes _next, static files, and /api/*.
  matcher: ["/admin/:path*", "/", "/((?!_next|favicon\\.ico|api/|.*\\..*).*)"],
};
