# BrotBot – Addendum: Data Audit & Precise Migration Instructions

> Supplements `brotbot_briefing_phase1.md`. This addendum is based on the actual analysis of the 6 uploaded JSON files and replaces the previous general statements in sections 3 and 5 of the main briefing with concrete, verified instructions. In case of conflict between the main briefing and this addendum, this addendum takes precedence.
>
> **Language note:** Like the main briefing, this document is written in English for Claude Code. All actual data values (`titel`, `kategorie`, `tags`, `fragevarianten`, `page_content`, etc.) referenced below remain in German, since they are real content from the German-language knowledge base. Do not translate any quoted German field values or content excerpts.

---

## 1. Data Audit Results (Summary)

The 6 existing files are valuable in content, but:

1. They still use the **old 6-retriever structure** (`retriever_domain` is a single string everywhere, not the planned array)
2. **Field names are inconsistent across files** (see section 3)
3. The `brotwissen_und_service` retriever consists **88% (42 of 48 entries) of content that doesn't actually belong to "service"**, but to the new 7th retriever `brot_sorten_und_wissen`
4. `unternehmen_und_leistungen` is extremely thin with only 3 entries
5. `brotideen` does not distinguish between actual recipes and pure serving suggestions
6. `produkte_und_allergene` contains **no** nutritional/calorie information (a genuine content gap, not something that can be fixed by reassignment)

---

## 2. Binding File Assignment of the 6 Source Files

| Source file | Total entries | Target retriever(s) |
|---|---|---|
| `baeckerei_mueller_filialen_und_kontakt_rag_v2.json` | 11 | entirely → `filialen_und_kontakt` |
| `baeckerei_mueller_app_und_kundenkarte_rag.json` | 21 | entirely → `app_und_kundenkarte` |
| `baeckerei_mueller_produkte_und_allergene_rag.json` | 57 | entirely → `produkte_allergene_naehrwerte` |
| `baeckerei_mueller_unternehmen_und_leistungen_rag.json` | 3 | entirely → `unternehmen_und_leistungen` |
| `baeckerei_mueller_brotideen_rag.json` | 105 | entirely → `brotideen_rezepte_inspiration` |
| `baeckerei_mueller_brotwissen_und_service_rag_v2.json` | 48 | **split, see section 4** |

---

## 3. Schema Normalization (mandatory before inserting into Supabase)

Claude Code must perform the following normalization for each entry while reading every file, before embedding + insert happens.

### 3.1 Required fields per entry (target state inside `metadata`)

```
id                 -- string; if currently an int (e.g. brotideen, id: 1) → cast to string ("1")
source_type
titel              -- unified field name "titel", NOT "title"
kategorie
tags               -- array, empty [] if not present, do not omit
fragevarianten     -- array, unified field name (see 3.2)
retriever_domain   -- array (see 3.3), even if it has only 1 value
canonical_topic
priority
```

### 3.2 Field name fixes per file

- **`app_und_kundenkarte`**: field is currently named `question_variants` → rename to `fragevarianten`
- **`brotwissen_und_service` (entries 0–41, 45–47, see section 4)**: field is named `title` → rename to `titel`. Missing fields `id`, `tags`, `kategorie`, `fragevarianten`, `source_type` must be added:
  - `id`: derive from `canonical_topic` (already a unique slug, can be used 1:1 as `id`)
  - `tags`: derive from the topic (e.g. for `was_ist_sauerteig` → `["sauerteig", "brotwissen"]`)
  - `kategorie`: assign a broad topic cluster (e.g. `"sauerteig"`, `"vollkorn"`, `"roggenbrot"`, `"brotkultur"`, `"naehrwerte"` — see clusters in section 4)
  - `fragevarianten`: generate at least 1–2 plausible German questions per entry (LLM-assisted during migration), since currently empty
  - `source_type`: set uniformly to `"brotwissen"`
- **`brotideen`**:
  - cast `id` from integer to string
  - `fragevarianten` is completely missing → generate 1–2 question variants per entry, derived from `titel` and `kategorie` (e.g. "Bauernbrot mit Butter und Schnittlauch" → "Hast du eine Idee für eine einfache Brotzeit?", "Was kann ich mit Bauernbrot machen?")
  - additionally extend `metadata.kategorie` with a classification **`rezept`** vs. **`serviervorschlag`**, derived from `detailgrad`:
    - `detailgrad: "spezifisch"` with a detailed `Zubereitung` step-by-step in `pageContent` → `rezept`
    - `detailgrad: "allgemein"`, `"kalt"`, `"warm"`, `"suess"`, `"brezen"` without concrete quantity/step instructions → `serviervorschlag`
    - Rule of thumb: if the text contains concrete preparation steps with quantities → `rezept`, otherwise `serviervorschlag`. When uncertain, default to `serviervorschlag` (conservative choice).

### 3.3 `retriever_domain` becomes an array

Currently a single string everywhere (e.g. `"retriever_domain": "filialen_und_kontakt"`). For **all** files, convert on insert to:

```json
"retriever_domain": ["filialen_und_kontakt"]
```

This is required because the Supabase schema (see main briefing section 4) expects `retriever_domain text[]` and must be ready for Phase 2 (multi-assignment via admin input). In Phase 1, almost every migrated entry has exactly one value in the array — exceptions are listed in section 4 (multi-assignment for Gluten/Zöliakie and Foodpairing).

---

## 4. Detailed Split of `brotwissen_und_service` (48 → 2 Target Retrievers)

This is the most important migration step. Table of all 48 entries, referenced via `canonical_topic` (unique slug in the source file).

### 4.1 → stays in `brotwissen_und_service` (6 entries: practical usage)

```
brot_lagerung
brot_einfrieren_auftauen
brot_aufbacken
schimmel_auf_brot
brot_lagern_einfrieren   -- NOTE: content overlaps with "brot_lagerung" and
                          -- "brot_einfrieren_auftauen" (clay bread crock,
                          -- freezing). Do not carry over 1:1 — instead merge
                          -- with the other two storage entries into ONE
                          -- consolidated document (duplicate-avoidance rule
                          -- from the main briefing: "merge instead of copy").
```

**Note:** `rezept_hinweis` (canonical_topic) is **not** an actual knowledge entry, but an internal behavioral rule for the bot ("if a bread also appears in the brotideen collection, the bot can ask whether the user is interested in a matching recipe"). This should **not** be migrated as a searchable RAG document, but added to the system prompt instead (see section 6).

### 4.2 → newly assigned to `brot_sorten_und_wissen` (39 entries: background knowledge)

```
teigruhe_bekoehmmlichkeit       frische_durch_teigreife        geschmack_und_kruste
was_ist_sauerteig               anstellgut                     fermentation
vorteile_von_sauerteig          bekoemmlichkeit_durch_sauerteig hefe_versus_sauerteig
verwendungen_von_sauerteig      sauerteig_aufbewahren           warum_mit_sauerteig_backen
vollkorn_wertvoll               was_steckt_im_korn              vollkorn_vorteile
vollkorn_backwaren              vollkorn_erkennen                vollkorn_in_der_backstube
vollkorn_fazit                  roggenbrot_brokultur             roggenbrot_bedeutung
roggenbrot_geschichte           roggenbrot_inhalt                roggen_als_getreide
roggenbrot_verwendung           deutsche_brotkultur              foodpairing_mit_brot
getreidevielfalt                welches_mehl_zum_backen          tag_des_deutschen_brotes
helles_brot_und_vollkorn        geschichte_der_hefe              brot_und_bier
deutsche_brotkultur_kulturerbe  redewendungen_brot
```

Recommended `kategorie` clusters within `brot_sorten_und_wissen` (for cleaner `metadata.kategorie` assignment):
- `sauerteig` (9 entries: was_ist_sauerteig through warum_mit_sauerteig_backen)
- `vollkorn` (7 entries)
- `roggenbrot` (6 entries)
- `brotkultur_und_geschichte` (deutsche_brotkultur, foodpairing_mit_brot, tag_des_deutschen_brotes, deutsche_brotkultur_kulturerbe, geschichte_der_hefe, redewendungen_brot, brot_und_bier)
- `backgrundlagen` (teigruhe_bekoehmmlichkeit, frische_durch_teigreife, geschmack_und_kruste, getreidevielfalt, welches_mehl_zum_backen, helles_brot_und_vollkorn)

### 4.3 → newly assigned to `produkte_allergene_naehrwerte` (4 entries: nutrition/allergens)

```
kohlenhydrate_im_brot
brot_naehrstoffe
warum_brot_wertvoll_ist
brot_und_diaet
```

These four are the only entries in the entire dataset that contain genuine nutritional statements (e.g. fiber, carbohydrates, micronutrients) — they partially close the nutrition gap mentioned in section 1, but do **not** replace concrete per-product calorie data (still missing, see section 7).

### 4.4 → multi-assignment (1 entry, both retrievers)

```
gluten_und_zoeliakie  →  retriever_domain: ["produkte_allergene_naehrwerte", "brot_sorten_und_wissen"]
```

Rationale: This is both an allergen-relevant safety question (leading: products/allergens) and general background knowledge. First actual use case in the whole dataset where the array structure from the schema is genuinely needed.

### 4.5 → newly assigned to `unternehmen_und_leistungen` (1 entry)

```
nachhaltigkeit_und_region
```

Rationale: Content covers delivery routes, regional ingredients, bakery/branch-network philosophy — fits the company presentation thematically, not bread knowledge. This also helps strengthen the heavily underpopulated `unternehmen_und_leistungen` retriever (previously only 3 entries).

### 4.6 → newly assigned to `unternehmen_und_leistungen` (1 more entry, borderline case)

```
handwerksbrot
```

Rationale: "Handwerksbäckerei und Handwerksbrot" covers tradition/philosophy of the craft bakery — content-wise closer to brand profile (cf. the existing entry `baeckerei_mueller_im_profil`) than to bread knowledge in the narrower sense.

### Checksum

6 (stays) + 39 (→ brot_sorten_und_wissen) + 4 (→ products) + 1 (multi-assignment) + 1 (nachhaltigkeit) + 1 (handwerksbrot) = **52 assignments for 48 entries** (correct, since `gluten_und_zoeliakie` is counted twice due to multi-assignment) − 1 (`rezept_hinweis`, becomes no RAG document) = 47 migrated documents. ✓ Matches the 48 source entries minus 1 non-document.

---

## 5. `unternehmen_und_leistungen`: Content-Gap Note

After migration per sections 4.5 and 4.6, this retriever grows from 3 to 5 entries. It remains the thinnest retriever in the overall system. This is **not a migration error**, but a genuine content gap that should be flagged to the customer as top priority for Phase 2 (admin interface): additional content on philosophy, awards, staff stories, etc. would make sense here.

---

## 6. System Prompt Addition

Building on section 4.1 (`rezept_hinweis`), the system prompt defined in the main briefing (section 6) should be extended with the following behavioral rule (keep this rule itself in German, since it instructs a German-speaking chatbot):

```
Wenn du nach einer Brotsorte oder einem Produkt gefragt wirst, zu dem es auch
passende Brotideen oder Rezepte gibt, biete proaktiv an, eine passende Idee
oder ein Rezept vorzuschlagen.
```

---

## 7. Known Gaps NOT Solvable Through Migration (for Phase 2 customer briefing)

These points are not a task for Claude Code in this sprint, but should be communicated to the customer as "this content is still missing" once the admin interface (Phase 2) is in place:

1. **No product-specific calorie/nutrition data** (0 of 57 products) — only the 4 general knowledge entries from 4.3 superficially cover this topic
2. **`unternehmen_und_leistungen` remains thin** (5 out of then ~250 total entries)
3. No content on diet/nutrition topics beyond the 4 migrated entries (e.g. low-carb, diabetic suitability)

---

## 8. Summary: Final Distribution After Migration

| Retriever | Entries (before → after) |
|---|---|
| `filialen_und_kontakt` | 11 → 11 |
| `app_und_kundenkarte` | 21 → 21 |
| `produkte_allergene_naehrwerte` | 57 → 62 (+4 nutrition entries, +1 gluten multi-assignment) |
| `brotwissen_und_service` | 48 → 6 (merged from 5 source entries due to storage duplicate) |
| `unternehmen_und_leistungen` | 3 → 5 |
| `brot_sorten_und_wissen` *(new)* | 0 → 39 |
| `brotideen_rezepte_inspiration` | 105 → 105 (internally split into `rezept`/`serviervorschlag`) |

---

## 9. Concrete Task for Claude Code (supplements main briefing section 10)

1. Perform schema normalization per section 3 for all 6 source files
2. Split `brotwissen_und_service` per the list in section 4 (by `canonical_topic` mapping, not a blanket rule)
3. Do NOT migrate the `rezept_hinweis` entry as a RAG document — instead fold it into the system prompt per section 6
4. For `brotideen_rezepte_inspiration`: add the `rezept`/`serviervorschlag` classification per the rule of thumb in 3.2
5. LLM-assist the generation of missing `fragevarianten` (rename-only for `app_und_kundenkarte`; newly generated for `brotwissen` and `brotideen` entries)
6. Convert all `retriever_domain` values into array form
7. Finally verify checksum: total document count after migration should be 11 + 21 + 62 + 6 + 5 + 39 + 105 = **249** (one entry, `rezept_hinweis`, intentionally does not become a document)
