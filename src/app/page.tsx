"use client";

import { useState, useRef, useEffect, useId } from "react";
import styles from "./chat.module.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      // This bubble is rendered before the first API call.
      // The actual first reply from the model will open with "Servus"
      // per the system prompt instruction — this is just the visual placeholder.
      content: "Servus! Ich bin der Müller BrotBot. Wie kann ich dir helfen?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // session_id lives in page memory — no localStorage, no cookies.
  // This satisfies the WebView compatibility requirement from the briefing.
  const sessionId = useRef(generateSessionId());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId.current }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Unbekannter Fehler");
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Ein Fehler ist aufgetreten. Bitte erneut versuchen."
      );
    } finally {
      setLoading(false);
      // Return focus to input after reply arrives
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Send on Enter; Shift+Enter inserts a newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // Auto-grow textarea as user types
  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  }

  return (
    <div className={styles.shell}>
      {/* ── Header ────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <span className={styles.logo}>🥖</span>
        <span className={styles.headerTitle}>BrotBot</span>
        <span className={styles.headerSub}>Bäckerei Müller</span>
      </header>

      {/* ── Message list ──────────────────────────────────────────── */}
      <main className={styles.messages} aria-live="polite" aria-label="Chatverlauf">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`${styles.bubble} ${msg.role === "user" ? styles.bubbleUser : styles.bubbleBot}`}
          >
            {msg.content}
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className={`${styles.bubble} ${styles.bubbleBot} ${styles.typing}`}>
            <span>BrotBot schreibt</span>
            <span className={styles.dots}>
              <span>.</span><span>.</span><span>.</span>
            </span>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* ── Input bar ─────────────────────────────────────────────── */}
      <footer className={styles.inputBar}>
        <label htmlFor={inputId} className={styles.srOnly}>
          Nachricht eingeben
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          className={styles.textarea}
          placeholder="Deine Frage…"
          rows={1}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={loading}
          aria-label="Nachricht eingeben"
        />
        <button
          className={styles.sendBtn}
          onClick={send}
          disabled={!input.trim() || loading}
          aria-label="Nachricht senden"
        >
          {loading ? (
            <span className={styles.spinner} aria-hidden="true" />
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          )}
        </button>
      </footer>
    </div>
  );
}
