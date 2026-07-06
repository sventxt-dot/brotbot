import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Keine Datei übermittelt" }, { status: 400 });
  }

  if (!("name" in file) || !(file as File).name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Nur PDF-Dateien werden unterstützt." },
      { status: 422 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Die Datei ist zu groß. Maximale Dateigröße: 10 MB." },
      { status: 422 }
    );
  }

  // Extract text from PDF
  let extractedText: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // pdf-parse v1 is a CommonJS module; dynamic require avoids Next.js
    // bundler issues with its internal fs.readFileSync test-fixture calls.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");
    const result = await pdfParse(buffer);
    extractedText = result.text.replace(/\s{2,}/g, " ").trim();
  } catch (err) {
    console.error("[Admin] analyze-pdf extraction failed:", err);
    return NextResponse.json(
      { error: "Das PDF konnte nicht gelesen werden. Bitte prüfe, ob es sich um ein gültiges PDF handelt." },
      { status: 422 }
    );
  }

  if (extractedText.length < 50) {
    return NextResponse.json(
      {
        error:
          "Kein Text im PDF gefunden — bitte prüfen, ob es sich um ein durchsuchbares PDF handelt (nicht nur ein Scan).",
      },
      { status: 422 }
    );
  }

  // Truncate to ~3000 tokens
  if (extractedText.length > 12000) extractedText = extractedText.slice(0, 12000) + " [...]";

  // LLM classification — same prompt as analyze-url
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Du bist ein Daten-Assistent für die Bäckerei Müller.
Analysiere den folgenden PDF-Inhalt und bestimme:
1. Einen kurzen Titel für diesen Inhalt (max. 80 Zeichen)
2. Eine kurze Zusammenfassung (2-3 Sätze auf Deutsch)
3. Welche der folgenden Wissensbereiche relevant sind (ein Array der passenden Slugs):
   - filialen_und_kontakt (Adressen, Öffnungszeiten, Kontakt)
   - app_und_kundenkarte (App, Kundenkarte, Bonuspunkte)
   - produkte_allergene_naehrwerte (Produkte, Zutaten, Allergene, Nährwerte)
   - brotwissen_und_service (Lagern, Einfrieren, Aufbacken)
   - unternehmen_und_leistungen (Geschichte, Handwerk, Philosophie)
   - brot_sorten_und_wissen (Brotsorten, Sauerteig, Vollkorn, Roggenbrot)
   - brotideen_rezepte_inspiration (Rezepte, Brotideen, Inspirationen)
PDF-Inhalt:
"${extractedText}"
Antworte NUR mit JSON:
{"titel":"...","zusammenfassung":"...","vorgeschlagene_retriever":["slug1","slug2"]}`,
      },
    ],
  });

  const rawText = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  const raw = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let parsed: { titel: string; zusammenfassung: string; vorgeschlagene_retriever: string[] };
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    console.error("[Admin] analyze-pdf JSON parse failed:", parseErr, "| raw:", raw);
    return NextResponse.json(
      { error: "LLM-Antwort konnte nicht verarbeitet werden." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    titel: parsed.titel,
    zusammenfassung: parsed.zusammenfassung,
    vorgeschlagene_retriever: parsed.vorgeschlagene_retriever,
    extracted_text: extractedText,
    filename: (file as File).name,
  });
}
