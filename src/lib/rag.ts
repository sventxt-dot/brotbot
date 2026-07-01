/**
 * RAG pipeline — embed query, search Supabase, return top-K context docs.
 *
 * Uses OpenAI text-embedding-3-large for query embedding and the
 * match_documents() Postgres function for vector similarity search.
 * All content stays in German; code/comments are English.
 */

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// Lazy init — runtime env vars from Coolify are not yet bound at module load.
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Use the anon key here — the chat endpoint only reads active documents.
// The service role key is used only in the migration script.
function getSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

export interface RetrievedDoc {
  id: string;
  retriever_domain: string[];
  page_content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

/**
 * Embed a user query and retrieve the top-K most similar documents.
 * Searches across all retrievers (no hard keyword pre-routing).
 */
export async function retrieveContext(
  query: string,
  matchCount = Number(process.env.RAG_MATCH_COUNT ?? 7)
): Promise<RetrievedDoc[]> {
  // Embed the query with the same model used during migration
  const embeddingRes = await getOpenAI().embeddings.create({
    model: "text-embedding-3-large",
    input: query,
  });
  const queryEmbedding = embeddingRes.data[0].embedding;

  // Call the match_documents() RPC function defined in schema.sql.
  // filter_retrievers is null → search all retrievers simultaneously.
  const { data, error } = await getSupabase().rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter_retrievers: null,
  });

  if (error) {
    throw new Error(`Supabase match_documents failed: ${error.message}`);
  }

  return (data ?? []) as RetrievedDoc[];
}

/**
 * Format retrieved documents into a context block for the Claude prompt.
 * Returns a compact German-readable string; source metadata is preserved
 * but not shown to the user (it stays in the API response for debugging).
 */
export function formatContext(docs: RetrievedDoc[]): string {
  if (docs.length === 0) return "";
  return docs
    .map((doc, i) => {
      const titel = doc.metadata.titel ?? "";
      const domain = doc.retriever_domain.join(", ");
      return `[${i + 1}] (${domain}${titel ? ` — ${titel}` : ""})\n${doc.page_content}`;
    })
    .join("\n\n---\n\n");
}
