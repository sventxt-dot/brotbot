import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RETRIEVER_DESCRIPTIONS } from "@/lib/admin";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { filename, extracted_text, retriever_domains, gueltig_von, gueltig_bis } =
    await request.json();

  if (!filename || !extracted_text || !retriever_domains?.length) {
    return NextResponse.json({ error: "Fehlende Pflichtfelder" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const today = new Date().toISOString().split("T")[0];
  const status = gueltig_von && gueltig_von > today ? "geplant" : "aktiv";

  let inserted = 0;
  const errors: string[] = [];

  for (const domain of retriever_domains as string[]) {
    try {
      const msg = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: `Du bist ein Daten-Assistent für die Bäckerei Müller.
Forme den folgenden PDF-Inhalt in einen kompakten Wissens-Eintrag für den Retriever "${domain}" um.
Dieser Retriever ist zuständig für: ${RETRIEVER_DESCRIPTIONS[domain]}
PDF-Inhalt:
"${extracted_text.slice(0, 6000)}"
Erstelle einen pageContent-Text (2-4 Sätze, sachlich, auf Deutsch) und passende Metadaten.
Antworte NUR mit JSON, kein Markdown:
{"page_content":"...","metadata":{"titel":"...","kategorie":"...","tags":["..."],"fragevarianten":["...","...","..."]}}`,
          },
        ],
      });

      const rawText = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
      const raw = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      let parsed: { page_content: string; metadata: Record<string, unknown> };
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { page_content: extracted_text.slice(0, 500), metadata: { titel: filename } };
      }

      const embRes = await openai.embeddings.create({
        model: "text-embedding-3-large",
        input: parsed.page_content,
      });
      const embedding = embRes.data[0].embedding;

      const { error: insertError } = await supabase.from("documents").insert({
        retriever_domain: [domain],
        page_content: parsed.page_content,
        embedding,
        metadata: {
          ...parsed.metadata,
          source_type: "admin_input",
          input_type: "pdf",
          created_by_input: filename,
        },
        gueltig_von: gueltig_von ?? null,
        gueltig_bis: gueltig_bis ?? null,
        status,
      } as any);

      if (insertError) throw new Error(insertError.message);
      inserted++;
    } catch (err) {
      console.error(`[Admin] ingest-pdf failed for domain ${domain}:`, err);
      errors.push(domain);
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
