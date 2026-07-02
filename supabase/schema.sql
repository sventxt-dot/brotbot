-- BrotBot – Supabase schema
-- Run once against the target database.
-- Requires pgvector extension (available on Supabase by default).

-- ---------------------------------------------------------------
-- 1. Extension
-- ---------------------------------------------------------------
create extension if not exists vector;

-- ---------------------------------------------------------------
-- 2. Main documents table
-- ---------------------------------------------------------------
create table if not exists documents (
  id                uuid        primary key default gen_random_uuid(),

  -- Retriever assignment (array — multi-assignment ready for Phase 2)
  retriever_domain  text[]      not null,

  -- Text used for retrieval — compact, readable German content
  page_content      text        not null,

  -- Embedding vector (text-embedding-3-large = 3072 dimensions)
  embedding         vector(3072),

  -- Flexible metadata blob (titel, kategorie, tags, fragevarianten, …)
  -- All field names and values stay in German (see briefing section 11)
  metadata          jsonb       not null default '{}'::jsonb,

  -- Phase 2 scheduling columns — not actively used in Phase 1,
  -- but must exist now so the Phase 2 admin can build on top seamlessly.
  gueltig_von       date,                        -- null = valid immediately
  gueltig_bis       date,                        -- null = permanently valid
  status            text        not null default 'aktiv'
                    check (status in ('aktiv', 'geplant', 'abgelaufen')),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------

-- No vector index at this scale (243 docs): sequential scan is fast enough.
-- If document count grows into the thousands, consider:
--   a) HNSW with reduced dims (≤ 2000) via OpenAI's `dimensions` parameter:
--        CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)
--   b) IVFFlat also requires ≤ 2000 dims — can't be used with full 3072.
-- Revisit when the table exceeds ~1 000 rows or query latency is noticeable.

-- Fast filtering by retriever (GIN on array column)
create index if not exists documents_retriever_domain_idx
  on documents using gin (retriever_domain);

-- Status + expiry filtering (Phase 2 scheduler)
create index if not exists documents_status_gueltig_bis_idx
  on documents (status, gueltig_bis);

-- ---------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------

alter table documents enable row level security;

-- Service role bypasses RLS entirely (used by the migration script and
-- any future admin writes). No explicit policy needed for service role.

-- Anon key (used by the chat frontend via /api/chat):
-- read-only access to aktiv + geplant documents.
-- 'abgelaufen' is excluded. Temporal relevance for 'geplant' docs is
-- handled by the LLM via [Gültig: ...] prefixes in the context block.
create policy "anon read aktiv und geplant"
  on documents for select
  to anon
  using (status in ('aktiv', 'geplant'));

-- ---------------------------------------------------------------
-- 5. updated_at trigger
-- ---------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger documents_updated_at
  before update on documents
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 6. Helper: match_documents (used by the /api/chat RAG pipeline)
--
--    Returns top-k documents by cosine similarity, optionally
--    filtered to one or more retriever domains.
--
--    No status filter — all documents are retrievable regardless of
--    aktiv/geplant/abgelaufen. The status and validity window
--    (gueltig_von / gueltig_bis) are returned as explicit columns so
--    the chat route can inject them into the LLM context as plain text.
--    The LLM then reasons about temporal relevance itself.
--
--    True removal is handled by hard-deleting rows, not by status.
--
--    Called from the backend via supabase.rpc('match_documents', …)
-- ---------------------------------------------------------------
create or replace function match_documents(
  query_embedding   vector(3072),
  match_count       int      default 7,
  filter_retrievers text[]   default null   -- null = search all retrievers
)
returns table (
  id               uuid,
  retriever_domain text[],
  page_content     text,
  metadata         jsonb,
  status           text,
  gueltig_von      date,
  gueltig_bis      date,
  similarity       float
)
language sql stable as $$
  select
    d.id,
    d.retriever_domain,
    d.page_content,
    d.metadata,
    d.status,
    d.gueltig_von,
    d.gueltig_bis,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where
    filter_retrievers is null
    or d.retriever_domain && filter_retrievers  -- array overlap
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
