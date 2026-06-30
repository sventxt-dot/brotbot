/**
 * BrotBot – Data Migration Script
 *
 * Reads all 6 source JSON files from Public/, applies schema normalization
 * and the brotwissen_und_service split per the migration addendum, generates
 * missing fragevarianten via Claude, embeds with text-embedding-3-large,
 * and inserts into Supabase. Verifies a final checksum of 243 documents.
 *
 * Run:          npx ts-node scripts/migrate.ts
 * Dry run:      DRY_RUN=1 npx ts-node scripts/migrate.ts
 *
 * DRY_RUN=1 makes ZERO external API calls (no OpenAI, no Anthropic, no
 * Supabase writes). It only validates normalization logic and reports what
 * the real run would do, including per-retriever doc counts and checksum.
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// ─── Config ────────────────────────────────────────────────────────────────

// Always run from project root (via npm run migrate / npx ts-node scripts/migrate.ts)
const PUBLIC_DIR = path.join(process.cwd(), "Public");
const DRY_RUN = process.env.DRY_RUN === "1";

// Lazy-init clients — not instantiated at all during dry run so missing
// credentials don't cause startup errors before we've validated structure.
let _supabase: ReturnType<typeof createClient> | null = null;
let _openai: OpenAI | null = null;
let _anthropic: Anthropic | null = null;

function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _supabase;
}
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface SourceEntry {
  pageContent?: string;
  page_content?: string;
  metadata: Record<string, unknown>;
}

interface NormalizedDoc {
  page_content: string;
  retriever_domain: string[];
  metadata: {
    id: string;
    source_type: string;
    titel: string;
    kategorie: string;
    tags: string[];
    fragevarianten: string[];
    canonical_topic: string;
    priority: number;
    [key: string]: unknown;
  };
}

// ─── Brotwissen split mapping ───────────────────────────────────────────────

const BROTWISSEN_MAP: Record<string, string[]> = {
  // Stays in brotwissen_und_service
  brot_lagerung:           ["brotwissen_und_service"],
  brot_einfrieren_auftauen: ["brotwissen_und_service"],
  brot_aufbacken:          ["brotwissen_und_service"],
  schimmel_auf_brot:       ["brotwissen_und_service"],

  // Merges into brot_lagerung (not its own doc — handled separately)
  brot_lagern_einfrieren:  ["__MERGE_INTO_LAGERUNG__"],

  // Not a RAG document — goes into system prompt
  rezept_hinweis:          ["__SKIP__"],

  // Reassigned to produkte_allergene_naehrwerte
  kohlenhydrate_im_brot:   ["produkte_allergene_naehrwerte"],
  brot_naehrstoffe:        ["produkte_allergene_naehrwerte"],
  warum_brot_wertvoll_ist: ["produkte_allergene_naehrwerte"],
  brot_und_diaet:          ["produkte_allergene_naehrwerte"],

  // Multi-assignment
  gluten_und_zoeliakie:    ["produkte_allergene_naehrwerte", "brot_sorten_und_wissen"],

  // Reassigned to unternehmen_und_leistungen
  nachhaltigkeit_und_region: ["unternehmen_und_leistungen"],
  handwerksbrot:             ["unternehmen_und_leistungen"],

  // All remaining 35 → brot_sorten_und_wissen
};

// Every slug not in the map above defaults to brot_sorten_und_wissen
function getRetrieverForBrotwissen(canonicalTopic: string): string[] {
  if (canonicalTopic in BROTWISSEN_MAP) {
    return BROTWISSEN_MAP[canonicalTopic];
  }
  return ["brot_sorten_und_wissen"];
}

// ─── kategorie clusters for brot_sorten entries ────────────────────────────

const BROT_SORTEN_KATEGORIEN: Record<string, string> = {
  teigruhe_bekoehmmlichkeit:       "backgrundlagen",
  frische_durch_teigreife:         "backgrundlagen",
  geschmack_und_kruste:            "backgrundlagen",
  getreidevielfalt:                "backgrundlagen",
  welches_mehl_zum_backen:         "backgrundlagen",
  helles_brot_und_vollkorn:        "backgrundlagen",
  was_ist_sauerteig:               "sauerteig",
  anstellgut:                      "sauerteig",
  fermentation:                    "sauerteig",
  vorteile_von_sauerteig:          "sauerteig",
  bekoemmlichkeit_durch_sauerteig: "sauerteig",
  hefe_versus_sauerteig:           "sauerteig",
  verwendungen_von_sauerteig:      "sauerteig",
  sauerteig_aufbewahren:           "sauerteig",
  warum_mit_sauerteig_backen:      "sauerteig",
  vollkorn_wertvoll:               "vollkorn",
  was_steckt_im_korn:              "vollkorn",
  vollkorn_vorteile:               "vollkorn",
  vollkorn_backwaren:              "vollkorn",
  vollkorn_erkennen:               "vollkorn",
  vollkorn_in_der_backstube:       "vollkorn",
  vollkorn_fazit:                  "vollkorn",
  roggenbrot_brokultur:            "roggenbrot",
  roggenbrot_bedeutung:            "roggenbrot",
  roggenbrot_geschichte:           "roggenbrot",
  roggenbrot_inhalt:               "roggenbrot",
  roggen_als_getreide:             "roggenbrot",
  roggenbrot_verwendung:           "roggenbrot",
  deutsche_brotkultur:             "brotkultur_und_geschichte",
  foodpairing_mit_brot:            "brotkultur_und_geschichte",
  tag_des_deutschen_brotes:        "brotkultur_und_geschichte",
  deutsche_brotkultur_kulturerbe:  "brotkultur_und_geschichte",
  geschichte_der_hefe:             "brotkultur_und_geschichte",
  redewendungen_brot:              "brotkultur_und_geschichte",
  brot_und_bier:                   "brotkultur_und_geschichte",
  gluten_und_zoeliakie:            "ernaehrung_und_vertraeglichkeit",
};

// Tags per brotwissen/brot_sorten topic (derived from topic + cluster)
const BROT_SORTEN_TAGS: Record<string, string[]> = {
  teigruhe_bekoehmmlichkeit:       ["teigruhe", "bekömmlichkeit", "brotwissen"],
  frische_durch_teigreife:         ["teigreife", "frische", "brotwissen"],
  geschmack_und_kruste:            ["geschmack", "kruste", "brotwissen"],
  getreidevielfalt:                ["getreide", "mehl", "brotwissen"],
  welches_mehl_zum_backen:         ["mehl", "backen", "brotwissen"],
  helles_brot_und_vollkorn:        ["hellbrot", "vollkorn", "brotwissen"],
  was_ist_sauerteig:               ["sauerteig", "brotwissen"],
  anstellgut:                      ["sauerteig", "anstellgut", "brotwissen"],
  fermentation:                    ["sauerteig", "fermentation", "brotwissen"],
  vorteile_von_sauerteig:          ["sauerteig", "vorteile", "brotwissen"],
  bekoemmlichkeit_durch_sauerteig: ["sauerteig", "bekömmlichkeit", "brotwissen"],
  hefe_versus_sauerteig:           ["sauerteig", "hefe", "brotwissen"],
  verwendungen_von_sauerteig:      ["sauerteig", "verwendung", "brotwissen"],
  sauerteig_aufbewahren:           ["sauerteig", "aufbewahren", "brotwissen"],
  warum_mit_sauerteig_backen:      ["sauerteig", "backen", "brotwissen"],
  vollkorn_wertvoll:               ["vollkorn", "gesundheit", "brotwissen"],
  was_steckt_im_korn:              ["vollkorn", "inhaltsstoffe", "brotwissen"],
  vollkorn_vorteile:               ["vollkorn", "vorteile", "brotwissen"],
  vollkorn_backwaren:              ["vollkorn", "backwaren", "brotwissen"],
  vollkorn_erkennen:               ["vollkorn", "qualität", "brotwissen"],
  vollkorn_in_der_backstube:       ["vollkorn", "backstube", "brotwissen"],
  vollkorn_fazit:                  ["vollkorn", "fazit", "brotwissen"],
  roggenbrot_brokultur:            ["roggenbrot", "brotkultur", "brotwissen"],
  roggenbrot_bedeutung:            ["roggenbrot", "bedeutung", "brotwissen"],
  roggenbrot_geschichte:           ["roggenbrot", "geschichte", "brotwissen"],
  roggenbrot_inhalt:               ["roggenbrot", "inhaltsstoffe", "brotwissen"],
  roggen_als_getreide:             ["roggen", "getreide", "brotwissen"],
  roggenbrot_verwendung:           ["roggenbrot", "verwendung", "brotwissen"],
  deutsche_brotkultur:             ["brotkultur", "deutschland", "brotwissen"],
  foodpairing_mit_brot:            ["foodpairing", "brot", "brotwissen"],
  tag_des_deutschen_brotes:        ["tag-des-brotes", "brotkultur", "brotwissen"],
  deutsche_brotkultur_kulturerbe:  ["brotkultur", "kulturerbe", "brotwissen"],
  geschichte_der_hefe:             ["hefe", "geschichte", "brotwissen"],
  redewendungen_brot:              ["redewendungen", "brot", "brotwissen"],
  brot_und_bier:                   ["brot", "bier", "brotkultur"],
  gluten_und_zoeliakie:            ["gluten", "zöliakie", "allergen", "brotwissen"],
  kohlenhydrate_im_brot:           ["kohlenhydrate", "nährwerte", "ernährung"],
  brot_naehrstoffe:                ["nährstoffe", "ernährung", "brotwissen"],
  warum_brot_wertvoll_ist:         ["nährstoffe", "gesundheit", "brotwissen"],
  brot_und_diaet:                  ["diät", "ernährung", "brotwissen"],
  nachhaltigkeit_und_region:       ["nachhaltigkeit", "region", "unternehmen"],
  handwerksbrot:                   ["handwerk", "bäckerei", "tradition"],
};

// ─── LLM-assisted fragevarianten generation ───────────────────────────────

// Dry-run stub — no API call, purely derived from titel/sourceType.
function stubFragevarianten(titel: string, sourceType: string): string[] {
  return [
    `[DRY-RUN] Was kann ich über „${titel}" wissen?`,
    `[DRY-RUN] Infos zu ${sourceType}: ${titel.slice(0, 40)}?`,
  ];
}

async function generateFragevarianten(
  titel: string,
  kategorie: string,
  pageContent: string,
  sourceType: string
): Promise<string[]> {
  // Dry run: return stubs, zero API calls.
  if (DRY_RUN) return stubFragevarianten(titel, sourceType);

  const prompt = `Du hilfst beim Aufbau einer RAG-Wissensdatenbank für einen Bäckerei-Chatbot (BrotBot der Bäckerei Müller).

Generiere genau 2 kurze, natürliche Kundenfragen auf Deutsch, die ein Kunde stellen würde und die mit folgendem Dokument beantwortet werden könnten:

Titel: ${titel}
Kategorie: ${kategorie}
Typ: ${sourceType}
Inhalt (Auszug): ${pageContent.slice(0, 400)}

Regeln:
- Fragen wie ein normaler Bäckerei-Kunde formulieren, nicht akademisch
- Keine Tautologien (nicht "Was ist ${titel}?")
- Jede Frage auf einer eigenen Zeile
- Nur die zwei Fragen ausgeben, kein zusätzlicher Text

Zwei Kundenfragen:`;

  const msg = await getAnthropic().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  const text = (msg.content[0] as { text: string }).text.trim();
  return text
    .split("\n")
    .map((l) => l.replace(/^[-–•\d.]\s*/, "").trim())
    .filter((l) => l.length > 10)
    .slice(0, 2);
}

// ─── Embedding ─────────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  if (DRY_RUN) return []; // no OpenAI calls during dry run
  const res = await getOpenAI().embeddings.create({
    model: "text-embedding-3-large",
    input: text,
  });
  return res.data[0].embedding;
}

// ─── File readers ──────────────────────────────────────────────────────────

function readJson(filename: string): SourceEntry[] {
  const raw = fs.readFileSync(path.join(PUBLIC_DIR, filename), "utf-8");
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : Object.values(data)[0] as SourceEntry[];
}

// ─── Normalizers per file type ─────────────────────────────────────────────

async function normalizeFilialen(entries: SourceEntry[]): Promise<NormalizedDoc[]> {
  return entries.map((e) => {
    const m = e.metadata;
    return {
      page_content: (e.pageContent || e.page_content || "") as string,
      retriever_domain: ["filialen_und_kontakt"],
      metadata: {
        id: String(m.id),
        source_type: String(m.source_type || "filiale"),
        titel: String(m.titel || m.title || ""),
        kategorie: String(m.kategorie || "filiale"),
        tags: (m.tags as string[]) || [],
        fragevarianten: (m.fragevarianten as string[]) || [],
        canonical_topic: String(m.canonical_topic || ""),
        priority: Number(m.priority || 1),
        // pass through location-specific fields
        ...(m.ort ? { ort: m.ort } : {}),
        ...(m.adresse ? { adresse: m.adresse } : {}),
        ...(m.telefon ? { telefon: m.telefon } : {}),
        ...(m.oeffnungszeiten_samstag ? { oeffnungszeiten_samstag: m.oeffnungszeiten_samstag } : {}),
        ...(m.oeffnungszeiten_sonntag ? { oeffnungszeiten_sonntag: m.oeffnungszeiten_sonntag } : {}),
        ...(m.sonntag_geoeffnet !== undefined ? { sonntag_geoeffnet: m.sonntag_geoeffnet } : {}),
      },
    };
  });
}

async function normalizeApp(entries: SourceEntry[]): Promise<NormalizedDoc[]> {
  return entries.map((e) => {
    const m = e.metadata;
    // question_variants → fragevarianten (the key fix for this file)
    const fv = (m.fragevarianten as string[]) ||
               (m.question_variants as string[]) || [];
    return {
      page_content: (e.pageContent || e.page_content || "") as string,
      retriever_domain: ["app_und_kundenkarte"],
      metadata: {
        id: String(m.id),
        source_type: String(m.source_type || "app"),
        titel: String(m.titel || m.title || ""),
        kategorie: String(m.kategorie || "app"),
        tags: (m.tags as string[]) || [],
        fragevarianten: fv,
        canonical_topic: String(m.canonical_topic || ""),
        priority: Number(m.priority || 1),
        ...(m.sources ? { sources: m.sources } : {}),
      },
    };
  });
}

async function normalizeProdukte(entries: SourceEntry[]): Promise<NormalizedDoc[]> {
  const docs: NormalizedDoc[] = [];
  for (const e of entries) {
    const m = e.metadata;
    const pageContent = (e.pageContent || e.page_content || "") as string;
    let fv = (m.fragevarianten as string[]) || [];

    if (fv.length === 0) {
      const titel = String(m.titel || m.title || "");
      const kat   = String(m.kategorie || "produkt");
      fv = await generateFragevarianten(titel, kat, pageContent, "produkt");
      console.log(`  ↳ fragevarianten generated for produkt: ${titel.slice(0, 50)}`);
    }

    docs.push({
      page_content: pageContent,
      // old domain value → new canonical name
      retriever_domain: ["produkte_allergene_naehrwerte"],
      metadata: {
        id: String(m.id),
        source_type: String(m.source_type || "produkt"),
        titel: String(m.titel || m.title || ""),
        kategorie: String(m.kategorie || "produkt"),
        tags: (m.tags as string[]) || [],
        fragevarianten: fv,
        canonical_topic: String(m.canonical_topic || ""),
        priority: Number(m.priority || 1),
        ...(m.unterkategorie ? { unterkategorie: m.unterkategorie } : {}),
        ...(m.quelle_url ? { quelle_url: m.quelle_url } : {}),
        ...(m.vegan !== undefined ? { vegan: m.vegan } : {}),
        ...(m.vegetarisch !== undefined ? { vegetarisch: m.vegetarisch } : {}),
        ...(m.available_now !== undefined ? { available_now: m.available_now } : {}),
        ...(m.seasonal !== undefined ? { seasonal: m.seasonal } : {}),
      },
    });
  }
  return docs;
}

async function normalizeUnternehmen(entries: SourceEntry[]): Promise<NormalizedDoc[]> {
  return entries.map((e) => {
    const m = e.metadata;
    return {
      page_content: (e.pageContent || e.page_content || "") as string,
      retriever_domain: ["unternehmen_und_leistungen"],
      metadata: {
        id: String(m.id),
        source_type: String(m.source_type || "unternehmen"),
        titel: String(m.titel || m.title || ""),
        kategorie: String(m.kategorie || "unternehmen"),
        tags: (m.tags as string[]) || [],
        fragevarianten: (m.fragevarianten as string[]) || [],
        canonical_topic: String(m.canonical_topic || ""),
        priority: Number(m.priority || 1),
        ...(m.merged_from ? { merged_from: m.merged_from } : {}),
      },
    };
  });
}

async function normalizeBrotideen(entries: SourceEntry[]): Promise<NormalizedDoc[]> {
  const docs: NormalizedDoc[] = [];
  for (const e of entries) {
    const m = e.metadata;
    const pageContent = (e.pageContent || e.page_content || "") as string;

    // Classify rezept vs. serviervorschlag
    const detailgrad = String(m.detailgrad || "allgemein");
    const hasZubereitungsSchritte =
      detailgrad === "spezifisch" &&
      /\d+[\.\)]\s/.test(pageContent); // numbered steps heuristic
    const subtyp = hasZubereitungsSchritte ? "rezept" : "serviervorschlag";

    // Generate fragevarianten (always missing in this file)
    const titel = String(m.titel || m.title || "");
    const kat   = String(m.kategorie || "brotidee");
    const fv = await generateFragevarianten(titel, kat, pageContent, "brotidee");
    if (!DRY_RUN) console.log(`  ↳ fragevarianten generated for brotidee: ${titel.slice(0, 50)}`);

    docs.push({
      page_content: pageContent,
      retriever_domain: ["brotideen_rezepte_inspiration"],
      metadata: {
        id: String(m.id),  // cast int → string
        source_type: "brotidee",
        titel,
        kategorie: kat,
        tags: (m.tags as string[]) || [],
        fragevarianten: fv,
        canonical_topic: String(m.canonical_topic || `brotidee_${m.id}`),
        priority: Number(m.priority || 1),
        detailgrad,
        subtyp,  // "rezept" | "serviervorschlag"
      },
    });
  }
  return docs;
}

async function normalizeBrotwissen(entries: SourceEntry[]): Promise<NormalizedDoc[]> {
  // Find the content of brot_lagern_einfrieren to merge into brot_lagerung
  const lagerungs_extra = entries.find(
    (e) => e.metadata.canonical_topic === "brot_lagern_einfrieren"
  );
  const lagerungs_extra_content = lagerungs_extra
    ? `\n\n${(lagerungs_extra.pageContent || lagerungs_extra.page_content || "").trim()}`
    : "";

  const docs: NormalizedDoc[] = [];

  for (const e of entries) {
    const m = e.metadata;
    const ct = String(m.canonical_topic || "");
    const retrieverTargets = getRetrieverForBrotwissen(ct);

    // Skip the two special cases
    if (retrieverTargets.includes("__SKIP__")) continue;
    if (retrieverTargets.includes("__MERGE_INTO_LAGERUNG__")) continue;

    let pageContent = (e.pageContent || e.page_content || "") as string;

    // Merge brot_lagern_einfrieren content into brot_lagerung
    if (ct === "brot_lagerung") {
      pageContent = pageContent.trim() + lagerungs_extra_content;
    }

    // Derive titel: already-structured entries have "titel", others have "title"
    const titel = String(m.titel || m.title || ct.replace(/_/g, " "));

    // Derive id from canonical_topic (the slug is already unique)
    const id = String(m.id || ct);

    // Derive tags from lookup table, fall back to m.tags
    const tags: string[] =
      (m.tags as string[]) ||
      BROT_SORTEN_TAGS[ct] ||
      [ct.replace(/_/g, ""), "brotwissen"];

    // Derive kategorie
    const kategorie = String(
      m.kategorie ||
      BROT_SORTEN_KATEGORIEN[ct] ||
      "brotwissen"
    );

    // fragevarianten: already-structured entries have them; others need generation
    let fv: string[] = (m.fragevarianten as string[]) || [];
    if (fv.length === 0) {
      fv = await generateFragevarianten(titel, kategorie, pageContent, "brotwissen");
      if (!DRY_RUN) console.log(`  ↳ fragevarianten generated for brotwissen: ${titel.slice(0, 50)}`);
    }

    docs.push({
      page_content: pageContent,
      retriever_domain: retrieverTargets,
      metadata: {
        id,
        source_type: String(m.source_type || m.source || "brotwissen"),
        titel,
        kategorie,
        tags,
        fragevarianten: fv,
        canonical_topic: ct,
        priority: Number(m.priority || 1),
      },
    });
  }
  return docs;
}

// ─── Insert with embedding ─────────────────────────────────────────────────

async function insertDoc(doc: NormalizedDoc): Promise<void> {
  const embedding = await embed(doc.page_content);
  const row = {
    retriever_domain: doc.retriever_domain,
    page_content: doc.page_content,
    embedding,
    metadata: doc.metadata,
    status: "aktiv",
  };

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would insert: ${doc.metadata.titel?.toString().slice(0, 60)}`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await getSupabase().from("documents").insert(row as any);
  if (error) throw new Error(`Insert failed for ${doc.metadata.canonical_topic}: ${error.message}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🥖 BrotBot Migration${DRY_RUN ? " [DRY RUN]" : ""}\n`);

  // ── Step 1: Read and normalize all files ──────────────────────────────
  console.log("Reading + normalizing source files…\n");

  const filialen   = await normalizeFilialen(readJson("baeckerei_mueller_filialen_und_kontakt_rag_v2_Final.json"));
  console.log(`✓ filialen_und_kontakt: ${filialen.length} docs`);

  const app        = await normalizeApp(readJson("baeckerei_mueller_app_und_kundenkarte_rag_Final.json"));
  console.log(`✓ app_und_kundenkarte: ${app.length} docs`);

  const produkte   = await normalizeProdukte(readJson("baeckerei_mueller_produkte_und_allergene_rag_Final.json"));
  console.log(`✓ produkte_allergene_naehrwerte: ${produkte.length} docs (incl. generated fragevarianten)`);

  const unternehmen = await normalizeUnternehmen(readJson("baeckerei_mueller_unternehmen_und_leistungen_rag_Final.json"));
  console.log(`✓ unternehmen_und_leistungen (base): ${unternehmen.length} docs`);

  console.log("\nGenerating fragevarianten for 105 brotideen entries…");
  const brotideen  = await normalizeBrotideen(readJson("baeckerei_mueller_brotideen_rag_Final.json"));
  console.log(`✓ brotideen_rezepte_inspiration: ${brotideen.length} docs`);

  console.log("\nProcessing brotwissen split (45 entries → 7 target buckets)…");
  const brotwissen = await normalizeBrotwissen(readJson("baeckerei_mueller_brotwissen_und_service_rag_v2_Final.json"));
  console.log(`✓ brotwissen split done: ${brotwissen.length} docs`);

  // ── Step 2: Bucket the brotwissen docs into retriever-specific counts ──
  const bw_service   = brotwissen.filter(d => d.retriever_domain.includes("brotwissen_und_service"));
  const bw_sorten    = brotwissen.filter(d => d.retriever_domain.includes("brot_sorten_und_wissen") && !d.retriever_domain.includes("produkte_allergene_naehrwerte"));
  const bw_produkte  = brotwissen.filter(d => d.retriever_domain.includes("produkte_allergene_naehrwerte") && !d.retriever_domain.includes("brot_sorten_und_wissen"));
  const bw_multi     = brotwissen.filter(d => d.retriever_domain.length > 1);
  const bw_unternehmen = brotwissen.filter(d => d.retriever_domain.includes("unternehmen_und_leistungen"));

  console.log("\n── Brotwissen split result ──────────────────────────────────");
  console.log(`  brotwissen_und_service:       ${bw_service.length}   (expect 4)`);
  console.log(`  brot_sorten_und_wissen:       ${bw_sorten.length + bw_multi.length}  (expect 36 incl. gluten)`);
  console.log(`  produkte_allergene_naehrwerte: ${bw_produkte.length + bw_multi.length}  (expect 5 = 4 nutrition + 1 gluten)`);
  console.log(`  unternehmen_und_leistungen:   ${bw_unternehmen.length}   (expect 2)`);
  console.log(`  multi-assigned:               ${bw_multi.length}   (expect 1 = gluten)`);

  // ── Step 3: Assemble all documents ────────────────────────────────────
  const allDocs: NormalizedDoc[] = [
    ...filialen,
    ...app,
    ...produkte,
    ...unternehmen,
    ...brotideen,
    ...brotwissen,
  ];

  // ── Step 4: Checksum verification ─────────────────────────────────────
  const EXPECTED_TOTAL = 243;
  console.log(`\n── Checksum ─────────────────────────────────────────────────`);
  console.log(`  Total documents to insert: ${allDocs.length}`);
  console.log(`  Expected:                  ${EXPECTED_TOTAL}`);

  if (allDocs.length !== EXPECTED_TOTAL) {
    console.error(`\n❌ CHECKSUM MISMATCH — aborting migration.`);
    console.error(`   Got ${allDocs.length}, expected ${EXPECTED_TOTAL}.`);
    console.error(`   Investigate the normalizer output above before retrying.`);
    process.exit(1);
  }
  console.log(`  ✅ Checksum OK\n`);

  // ── Step 5: Embed + insert (skipped entirely in dry run) ─────────────
  let inserted = 0;
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would embed + insert ${allDocs.length} documents.`);
    console.log(`  OpenAI text-embedding-3-large: ${allDocs.length} calls`);
    console.log(`  Claude fragevarianten generation: ~${
      allDocs.filter(d => !d.metadata.fragevarianten || (d.metadata.fragevarianten as string[])[0]?.startsWith("[DRY")).length
    } calls (entries without pre-existing fragevarianten)`);
    console.log(`  Supabase inserts: ${allDocs.length} rows into documents table`);
    inserted = allDocs.length; // report as if done, for the summary line
  } else {
    console.log(`Embedding and inserting ${allDocs.length} documents into Supabase…\n`);
    for (const doc of allDocs) {
      await insertDoc(doc);
      inserted++;
      if (inserted % 10 === 0) {
        process.stdout.write(`  ${inserted}/${allDocs.length}…\r`);
      }
    }
  }

  // ── Step 6: Final per-retriever count from DB ──────────────────────────
  if (!DRY_RUN) {
    console.log("\n── Per-retriever count in Supabase ─────────────────────────");
    const retrievers = [
      "filialen_und_kontakt",
      "app_und_kundenkarte",
      "produkte_allergene_naehrwerte",
      "brotwissen_und_service",
      "unternehmen_und_leistungen",
      "brot_sorten_und_wissen",
      "brotideen_rezepte_inspiration",
    ];
    for (const r of retrievers) {
      const { count } = await getSupabase()
        .from("documents")
        .select("*", { count: "exact", head: true })
        .contains("retriever_domain", [r]);
      console.log(`  ${r}: ${count}`);
    }
    const { count: total } = await getSupabase()
      .from("documents")
      .select("*", { count: "exact", head: true });
    console.log(`\n  Distinct total: ${total} (expect ${EXPECTED_TOTAL})`);
  }

  console.log(`\n✅ Migration complete — ${inserted} documents processed.\n`);
}

main().catch((err) => {
  console.error("\n❌ Migration failed:", err);
  process.exit(1);
});
