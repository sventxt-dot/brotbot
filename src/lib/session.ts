/**
 * Server-side conversation memory.
 *
 * Stores the last N turns per session_id in a plain in-process Map.
 * This is intentionally simple for Phase 1 — no persistence across
 * server restarts, no external store. Phase 2 can swap this for
 * Supabase-backed storage without changing the call sites.
 *
 * Not safe for multi-replica deployments without sticky sessions,
 * but fine for a single Coolify container running Phase 1.
 */

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

const MAX_TURNS = 10; // keep last 10 turns (5 user + 5 assistant)
const sessions = new Map<string, Turn[]>();

export function getHistory(sessionId: string): Turn[] {
  return sessions.get(sessionId) ?? [];
}

export function appendTurn(sessionId: string, turn: Turn): void {
  const history = sessions.get(sessionId) ?? [];
  history.push(turn);
  // Trim to the last MAX_TURNS turns
  if (history.length > MAX_TURNS) history.splice(0, history.length - MAX_TURNS);
  sessions.set(sessionId, history);
}

/** Wipe a session (not used in Phase 1, but useful for testing). */
export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}
