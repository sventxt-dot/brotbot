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
  status: string;
  gueltig_von: string | null;
  gueltig_bis: string | null;
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

// Format a Supabase date string ("2026-12-24") as German "24.12.2026".
function formatDateDE(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Build the [Gültig: ...] prefix for documents that have a validity window.
function validityPrefix(doc: RetrievedDoc): string {
  const von = doc.gueltig_von;
  const bis = doc.gueltig_bis;
  if (von && bis) return `[Gültig: ${formatDateDE(von)} – ${formatDateDE(bis)}] `;
  if (von) return `[Gültig ab: ${formatDateDE(von)}] `;
  if (bis) return `[Gültig bis: ${formatDateDE(bis)}] `;
  return "";
}

/**
 * Format retrieved documents into a context block for the Claude prompt.
 * Validity windows are prepended as [Gültig: ...] so the LLM can reason
 * about temporal relevance. Source metadata stays in the API response for
 * debugging but is not shown to the user.
 */
export function formatContext(docs: RetrievedDoc[]): string {
  if (docs.length === 0) return "";
  return docs
    .map((doc, i) => {
      const titel = doc.metadata.titel ?? "";
      const domain = doc.retriever_domain.join(", ");
      const prefix = validityPrefix(doc);
      return `[${i + 1}] (${domain}${titel ? ` — ${titel}` : ""})\n${prefix}${doc.page_content}`;
    })
    .join("\n\n---\n\n");
}
