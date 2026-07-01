import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function extractText(html: string): string {
  // Remove script, style, nav, footer, header, head blocks and their content.
  let text = html
    .replace(/<(script|style|nav|footer|header|head|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Truncate to ~3000 tokens (rough estimate: 4 chars per token).
  if (text.length > 12000) text = text.slice(0, 12000) + " [...]";

  return text;
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { url } = await request.json();
  if (!url) return NextResponse.json({ error: "Fehlende URL" }, { status: 400 });

  // Step 1 — Fetch the URL
  let extractedText: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "BrotBot-Admin/1.0 (+https://brotbot.bot-boutique.com)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    extractedText = extractText(html);
    if (!extractedText) throw new Error("Kein lesbarer Text gefunden");
  } catch (err) {
    console.error("[Admin] analyze-url fetch failed:", err);
    return NextResponse.json(
      { success: false, error: "Diese Seite konnte nicht gelesen werden. Bitte prüfe die URL oder versuche es mit einer anderen Seite." },
      { status: 422 }
    );
  }

  // Step 2 — LLM classification
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Du bist ein Daten-Assistent für die Bäckerei Müller.
Analysiere den folgenden Webseiteninhalt und bestimme:
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
Webseiteninhalt:
"${extractedText}"
Antworte NUR mit JSON:
{"titel":"...","zusammenfassung":"...","vorgeschlagene_retriever":["slug1","slug2"]}`,
      },
    ],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  let parsed: { titel: string; zusammenfassung: string; vorgeschlagene_retriever: string[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ success: false, error: "LLM-Antwort konnte nicht verarbeitet werden." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    titel: parsed.titel,
    zusammenfassung: parsed.zusammenfassung,
    vorgeschlagene_retriever: parsed.vorgeschlagene_retriever,
    extracted_text: extractedText,
  });
}
