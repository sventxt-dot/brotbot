/**
 * POST /api/chat
 *
 * Body:   { message: string; session_id: string }
 * Response: { reply: string; sources: RetrievedDoc[] }
 *
 * Flow:
 *  1. Embed the user's message (OpenAI text-embedding-3-large)
 *  2. Retrieve top-K relevant documents via match_documents() (semantic search,
 *     no hard keyword routing, all retrievers searched simultaneously)
 *  3. Build the prompt: system prompt + conversation history + context + question
 *  4. Call Claude to generate a German reply
 *  5. Append both turns to the server-side session history
 *  6. Return reply + source metadata for optional frontend debugging
 */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { retrieveContext, formatContext, type RetrievedDoc } from "@/lib/rag";
import { getHistory, appendTurn } from "@/lib/session";
import { buildSystemPrompt } from "@/lib/prompt";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  // ── Parse and validate input ────────────────────────────────────────────
  let message: string;
  let session_id: string;

  try {
    const body = await req.json();
    message = String(body.message ?? "").trim();
    session_id = String(body.session_id ?? "").trim();
  } catch {
    return NextResponse.json(
      { error: "Ungültige Anfrage — JSON konnte nicht gelesen werden." },
      { status: 400 }
    );
  }

  if (!message) {
    return NextResponse.json(
      { error: "Nachricht darf nicht leer sein." },
      { status: 400 }
    );
  }
  if (!session_id) {
    return NextResponse.json(
      { error: "session_id fehlt." },
      { status: 400 }
    );
  }

  // ── Retrieve context ────────────────────────────────────────────────────
  let docs: RetrievedDoc[];
  try {
    docs = await retrieveContext(message);
  } catch (err) {
    console.error("[BrotBot] RAG retrieval failed:", err);
    return NextResponse.json(
      { error: "Fehler beim Abrufen der Wissensbasis. Bitte später erneut versuchen." },
      { status: 502 }
    );
  }

  const context = formatContext(docs);

  // ── Build messages for Claude ───────────────────────────────────────────
  // Check first-turn *before* appending anything so the flag is accurate.
  const history = getHistory(session_id);
  const isFirstTurn = history.length === 0;

  // Conversation history turns (prior user/assistant exchanges)
  const historyMessages: Anthropic.MessageParam[] = history.map((t) => ({
    role: t.role,
    content: t.content,
  }));

  // Current user turn — context injected as a prefixed block so Claude
  // always has the retrieved knowledge available, regardless of history length.
  const userContent =
    context.length > 0
      ? `Kontext aus der Wissensdatenbank:\n\n${context}\n\n---\n\nFrage: ${message}`
      : `Frage: ${message}`;

  // ── Call Claude ─────────────────────────────────────────────────────────
  let reply: string;
  try {
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5",
      max_tokens: 1024,
      system: buildSystemPrompt(isFirstTurn),
      messages: [
        ...historyMessages,
        { role: "user", content: userContent },
      ],
    });
    reply = (response.content[0] as { text: string }).text.trim();
  } catch (err) {
    console.error("[BrotBot] Claude API failed:", err);
    return NextResponse.json(
      { error: "Fehler beim Generieren der Antwort. Bitte später erneut versuchen." },
      { status: 502 }
    );
  }

  // ── Persist conversation turns ──────────────────────────────────────────
  // Store the raw user message (not the context-prefixed version) so history
  // reads naturally in subsequent turns.
  appendTurn(session_id, { role: "user", content: message });
  appendTurn(session_id, { role: "assistant", content: reply });

  // ── Return response ─────────────────────────────────────────────────────
  return NextResponse.json({
    reply,
    sources: docs.map((d) => ({
      id: d.id,
      retriever_domain: d.retriever_domain,
      titel: d.metadata.titel,
      similarity: Math.round(d.similarity * 1000) / 1000,
    })),
  });
}
