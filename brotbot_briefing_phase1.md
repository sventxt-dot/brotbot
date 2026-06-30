# BrotBot – Technical Briefing for Claude Code

## Phase 1: RAG Chatbot (Backend) + Chat Website (Frontend)

> This document is the full specification for rebuilding the Bäckerei Müller chatbot ("BrotBot") outside of Flowise. Phase 2 (admin interface for content management) follows in a separate briefing and is **not** part of this sprint.
>
> **Language note:** This briefing is written in English for Claude Code. The actual chatbot, all user-facing UI text, and all retrieved content remain in **German** — this is a chatbot for German-speaking bakery customers in Bavaria. Do not translate any German content, field values, or chatbot responses into English.

---

## 1. Project Context

The previous chatbot ran in Flowise using an **in-memory vector store** (6 JSON files, manually uploaded, no persistent or API-accessible storage). The goal is a full rebuild with:

- a persistent, self-controlled vector store
- a clean 7-retriever structure (instead of the previous 6)
- a standalone chat website that will later be embedded both in the bakery app (via WebView) and on the website (via link/button)
- preparation for a future admin interface (Phase 2), without building it yet

---

## 2. Tech Stack (fixed)

| Component | Choice |
|---|---|
| Vector store + DB | Supabase (self-hosted via Coolify), Postgres + `pgvector` |
| Auth (prepare for Phase 2, not used yet in Phase 1) | Supabase Auth |
| Embedding model | OpenAI `text-embedding-3-large` |
| Chat model | Anthropic Claude (model choice, see section 7) |
| Backend | Node.js (TypeScript) — API routes for `/api/chat` |
| Frontend (chat website) | Next.js, mobile-first, since it will later be embedded via WebView in the app |
| Hosting | Coolify (own server, same environment as Supabase) |

---

## 3. The 7 Retrievers (binding structure)

This is the final, agreed structure — **not** the original 6 from the raw JSON files. Please re-sort accordingly during migration; do not carry over the old structure 1:1.

1. **`filialen_und_kontakt`**
   Addresses, opening hours, branch phone numbers, location overview, headquarters, office availability, large orders (if tied to the main office)

2. **`app_und_kundenkarte`**
   App download, app features, digital loyalty card, bonus points, top-up balance/top-up bonus, in-app payment, pre-orders, app coupons, app benefits

3. **`produkte_allergene_naehrwerte`**
   Product data, ingredients, allergens, vegan/vegetarian, product categories, availability, product-level assortment details, **nutritional values/calories** (new addition compared to the original structure)

4. **`brotwissen_und_service`**
   Storing, freezing, reheating, thawing bread, shelf life, practical usage tips

5. **`unternehmen_und_leistungen`**
   Company history, baking craft, philosophy, brand profile, general production info, supply customers, clubs/festivals, general branch-network statements without specific branch details

6. **`brot_sorten_und_wissen`** *(new retriever)*
   Bread types and their characteristics (e.g. rye vs. wheat, sourdough), quality criteria when buying, general background knowledge about bread (not product-specific, but knowledge-oriented)

7. **`brotideen_rezepte_inspiration`** *(merged from the original "brotideen")*
   Cold/warm bread ideas, recipes with instructions, snack/meal inspiration, serving suggestions

### Routing rules (for retrieval logic in the backend)

- **One primary topic = primarily one retriever**, but retrieval may search multiple retrievers simultaneously when needed (see section 6)
- Leading source when topics overlap:
  - Opening hours → `filialen_und_kontakt`
  - App features/loyalty card → `app_und_kundenkarte`
  - Product/allergen/nutrition questions → `produkte_allergene_naehrwerte`
  - Bread storage/care → `brotwissen_und_service`
  - Company presentation → `unternehmen_und_leistungen`
  - Bread types/quality in general → `brot_sorten_und_wissen`
  - Inspiration/recipes → `brotideen_rezepte_inspiration`

---

## 4. Data Model (Supabase / Postgres)

```sql
-- enable extension
create extension if not exists vector;

-- main table for all RAG content
create table documents (
  id uuid primary key default gen_random_uuid(),
  retriever_domain text[] not null,        -- array: multi-assignment possible (prep for Phase 2)
  page_content text not null,               -- text for retrieval (compact, readable) — content stays in German
  embedding vector(3072),                   -- text-embedding-3-large = 3072 dimensions
  metadata jsonb not null default '{}'::jsonb,
  -- expected metadata fields: titel, kategorie, tags, fragevarianten,
  -- quelle_url, source_type, ort, adresse, telefon (optional depending on type)
  -- NOTE: field names and values stay in German (see section 11 on naming convention)

  gueltig_von date,                         -- null = valid immediately
  gueltig_bis date,                         -- null = permanently valid (prep for Phase 2)
  status text not null default 'aktiv',     -- 'aktiv' | 'geplant' | 'abgelaufen'

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- index for vector similarity search
create index on documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- index for retriever filtering
create index on documents using gin (retriever_domain);

-- index for status filtering (relevant for Phase 2 scheduler, but column must exist now)
create index on documents (status, gueltig_bis);
```

**Important for Claude Code:** The columns `gueltig_von`, `gueltig_bis`, `status` are not actively used in Phase 1 (all migrated documents get `status = 'aktiv'`, `gueltig_bis = null`), but must already exist in the schema so Phase 2 can build on top seamlessly.

---

## 5. Data Migration (existing JSON files → new structure)

### Starting point
6 JSON files from the previous Flowise setup, already manually re-sorted into the new 7-retriever structure by the project owner (see uploaded files `baeckerei_mueller_*_rag*.json`). A separate, detailed migration addendum (`brotbot_briefing_addendum_migration.md`) specifies the exact reassignment per entry — **follow that addendum precisely**, it takes precedence over general assumptions.

### Task for Claude Code

1. Read all 6 existing JSON files
2. Apply the precise reassignment instructions from `brotbot_briefing_addendum_migration.md` (entry-level reassignment between retrievers, especially the split of `brotwissen_und_service` into `brotwissen_und_service` and `brot_sorten_und_wissen`)
3. Normalize field names and schema per entry as specified in the addendum (German field names like `titel`, `fragevarianten`, `kategorie`, `tags` stay German — only the migration logic/code is in English)
4. Merge duplicates instead of copying them (see addendum)
5. Bring every entry to the target schema (section 4):
   - `page_content`: compact, readable German text with all key facts
   - `metadata`: at minimum `titel`, `kategorie`, `tags`, `fragevarianten`, `source_type`; optionally `quelle_url`, `ort`, `adresse`, `telefon`
   - `retriever_domain`: array with one or more of the 7 target values
6. Embed texts (`text-embedding-3-large`) and insert into Supabase

### Quality rule for migration

Product entries should be content-shortened but without information loss: all facts are preserved, `page_content` becomes more compact, detail fields move into `metadata`.

---

## 6. RAG Pipeline / Backend Logic

### Endpoint

```
POST /api/chat
Body: { "message": string, "session_id": string }
Response: { "reply": string, "sources"?: object[] }
```

### Flow per request

1. Embed the user's question (`text-embedding-3-large`)
2. Vector similarity search across **all** retrievers simultaneously (no hard keyword pre-routing like in the old Flowise setup — instead, similarity search naturally surfaces the most relevant documents across `retriever_domain` boundaries)
3. Only consider documents with **`status = 'aktiv'`** (preparation for the Phase 2 scheduler logic; in Phase 1 all documents are active anyway)
4. Pass the top-K relevant documents (suggested: K = 5–8, tune iteratively) to Claude as context
5. Claude generates a response based on context + conversation history (`session_id` for simple memory, e.g. cache the last 5–10 turns server-side)
6. Return the response

**Note on routing philosophy:** Unlike the old Flowise setup (manual keyword routing to a single retriever), the new solution should rely on **semantic similarity search across the full document set**, filtered/weighted via `retriever_domain` if needed. This is more robust than rigid keyword lists and reduces misrouting on ambiguous questions (e.g. "Do you have vegan bread snack ideas?" → potentially touches two retrievers at once).

### System prompt skeleton (starting point for Claude Code — keep this prompt itself in German, since it instructs a German-speaking chatbot)

```
Du bist BrotBot, der freundliche Chat-Assistent der Bäckerei Müller.
Beantworte Fragen ausschließlich auf Basis der bereitgestellten Kontext-Dokumente.
Wenn die Information nicht in den Dokumenten enthalten ist, sage das ehrlich
und verweise auf die direkte Kontaktaufnahme mit der Bäckerei.
Antworte in einem freundlichen, regionalen, unkomplizierten Ton.
Antworte auf Deutsch.
```

---

## 7. Open Question: Claude Model

Previously in Flowise: `claude-haiku-4-5`. For Phase 1, **keep Haiku for now** (cost advantage, usually sufficient for FAQ-style RAG answers), but keep the model name configurable via environment variable so an upgrade is possible without code changes:

```
ANTHROPIC_MODEL=claude-haiku-4-5
```

---

## 8. Frontend: Chat Website

### Requirements

- **Mobile-first**, since the page will later be embedded via WebView in the bakery app (constrained browser environment, no hover UI, large tap targets)
- Standalone URL (e.g. `chat.baeckerei-mueller.de`), independently runnable
- Slim chat interface: history, input field, send button, loading indicator while Claude is responding
- **All UI text, labels, placeholders, and error messages in German** (e.g. "Nachricht senden", "BrotBot schreibt...", not English equivalents)
- No login/auth needed (Phase 1 only covers the end-customer chat, no admin area)
- No dependency on LocalStorage/cookies for core functionality (WebView compatibility); `session_id` can be handled server-side or in page memory

### Not part of Phase 1

- Admin login (Supabase Auth) — schema preparation yes, UI no
- Free-text input interface for staff
- iframe/bubble embed on the main website (comes later, see section 9)

---

## 9. Outlook (not part of this sprint, for context only)

- **Phase 2:** Admin interface with Supabase Auth login for multiple staff members, free-text input + retriever checkboxes (multi-select) + calendar for time-bound content, LLM normalization of the free text per selected target retriever (contextualized variants instead of a 1:1 duplicate), automatic status transition `geplant → aktiv → abgelaufen` via daily scheduler
- **Phase 3:** Embedding the chat page as a link/button into the existing bakery app (WebView) and on the main website

---

## 10. Concrete Task for Claude Code This Sprint

1. Set up the Supabase schema per section 4 (incl. `pgvector`)
2. Migration script: read the 6 existing JSON files, restructure per section 3 + 5 and the migration addendum, embed, insert into Supabase
3. Build the backend API `/api/chat` per section 6
4. Build the chat website per section 8
5. Deploy in a way that's testable locally and on Coolify

---

## 11. Naming Convention Note (important)

Throughout the codebase, **technical identifiers stay in German** where they originated that way in the source data and content schema — this is intentional, not an oversight:

- Retriever names: `filialen_und_kontakt`, `app_und_kundenkarte`, `produkte_allergene_naehrwerte`, `brotwissen_und_service`, `unternehmen_und_leistungen`, `brot_sorten_und_wissen`, `brotideen_rezepte_inspiration`
- Metadata field names: `titel`, `kategorie`, `tags`, `fragevarianten`, `quelle_url`, `retriever_domain`, `canonical_topic`, `gueltig_von`, `gueltig_bis`, `status`
- All `page_content` values and chatbot responses

Code comments, variable names in application logic (outside the German content schema), commit messages, and this briefing itself should be in English, as is standard practice for the codebase.
