import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { page_content, titel, retriever_domains, gueltig_von, gueltig_bis, original_source, input_type } =
    await request.json();

  if (!page_content?.trim() || !retriever_domains?.length) {
    return NextResponse.json({ error: "Fehlende Pflichtfelder" }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const today = new Date().toISOString().split("T")[0];
  const status =
    gueltig_von && gueltig_von > today
      ? "geplant"
      : gueltig_bis && gueltig_bis < today
      ? "abgelaufen"
      : "aktiv";

  // One embedding shared across all retriever rows for this entry.
  const embRes = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: page_content.trim(),
  });
  const embedding = embRes.data[0].embedding;

  let inserted = 0;
  const errors: string[] = [];

  for (const domain of retriever_domains as string[]) {
    const { error: insertError } = await supabase.from("documents").insert({
      retriever_domain: [domain],
      page_content: page_content.trim(),
      embedding,
      metadata: {
        titel: titel ?? page_content.trim().slice(0, 80),
        source_type: "admin_input",
        input_type: input_type ?? "freitext",
        created_by_input: original_source ?? page_content.trim(),
      },
      gueltig_von: gueltig_von ?? null,
      gueltig_bis: gueltig_bis ?? null,
      status,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    if (insertError) {
      console.error(`[Admin] ingest-direct failed for domain ${domain}:`, insertError);
      errors.push(domain);
    } else {
      inserted++;
    }
  }

  if (inserted === 0) {
    return NextResponse.json(
      { success: false, error: "Kein Eintrag konnte gespeichert werden." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, inserted, errors });
}
