import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-scheduler-secret");
  if (!secret || secret !== process.env.SCHEDULER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Uses service role not available at runtime — use anon key with a direct
  // SQL call. The scheduler updates happen server-side with no RLS restriction
  // needed since we pass the service role via the secret header pattern.
  // For simplicity, use the anon key and rely on a permissive policy, or
  // alternatively use the service role key if added to env.
  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
    }
  );

  // Expire documents past their end date.
  const { data: expired, error: expireError } = await supabase
    .from("documents")
    .update({ status: "abgelaufen", updated_at: new Date().toISOString() })
    .eq("status", "aktiv")
    .not("gueltig_bis", "is", null)
    .lt("gueltig_bis", new Date().toISOString().split("T")[0])
    .select("id");

  if (expireError) {
    console.error("[Scheduler] expire failed:", expireError);
    return NextResponse.json({ error: expireError.message }, { status: 500 });
  }

  // Activate documents whose start date has arrived.
  const { data: activated, error: activateError } = await supabase
    .from("documents")
    .update({ status: "aktiv", updated_at: new Date().toISOString() })
    .eq("status", "geplant")
    .not("gueltig_von", "is", null)
    .lte("gueltig_von", new Date().toISOString().split("T")[0])
    .select("id");

  if (activateError) {
    console.error("[Scheduler] activate failed:", activateError);
    return NextResponse.json({ error: activateError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    expired: expired?.length ?? 0,
    activated: activated?.length ?? 0,
  });
}
