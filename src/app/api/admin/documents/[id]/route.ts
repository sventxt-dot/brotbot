import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Safety guard: only admin_input documents may be deleted.
  const { data: doc, error: fetchError } = await supabase
    .from("documents")
    .select("id, metadata")
    .eq("id", id)
    .single();

  if (fetchError || !doc) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  if ((doc.metadata as Record<string, unknown>)?.source_type !== "admin_input") {
    return NextResponse.json(
      { error: "Nur admin_input-Einträge dürfen gelöscht werden." },
      { status: 403 }
    );
  }

  const { error: deleteError } = await supabase.from("documents").delete().eq("id", id);

  if (deleteError) {
    console.error("[Admin] DELETE /documents/:id failed:", deleteError);
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
