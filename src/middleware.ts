import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

// @supabase/ssr uses Node.js APIs not available in the Edge runtime.
export const runtime = "nodejs";

export async function middleware(request: NextRequest) {
  // If the request arrives on the admin subdomain but without an /admin prefix,
  // rewrite transparently so /  →  /admin, /login → /admin/login, etc.
  const hostname = request.headers.get("host") ?? "";
  if (hostname.startsWith("admin.")) {
    const path = request.nextUrl.pathname;
    if (!path.startsWith("/admin")) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin" + (path === "/" ? "" : path);
      return NextResponse.rewrite(url);
    }
  }

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

  // Refresh session — required for @supabase/ssr to keep tokens alive.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // API routes handle their own auth — never redirect them.
  if (path.startsWith("/api/")) {
    return supabaseResponse;
  }

  // Public admin routes — no auth required.
  if (path.startsWith("/admin/login") || path.startsWith("/admin/auth")) {
    return supabaseResponse;
  }

  // All other /admin/* routes require a valid session.
  if (!user) {
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
