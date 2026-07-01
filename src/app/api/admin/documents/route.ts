import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("documents")
    .select("id, retriever_domain, metadata, status, gueltig_von, gueltig_bis, created_at")
    .eq("metadata->>source_type", "admin_input")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Admin] GET /documents failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ documents: data ?? [] });
}
