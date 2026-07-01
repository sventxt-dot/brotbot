"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin.module.css";
import { RETRIEVER_DOMAINS, RETRIEVER_ABBREV, type AdminDocument } from "@/lib/admin";

// ── Types ──────────────────────────────────────────────────────────────────

interface AnalysisResult {
  titel: string;
  zusammenfassung: string;
  vorgeschlagene_retriever: string[];
  extracted_text: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatGermanDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " Uhr"
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "aktiv"
      ? styles.statusAktiv
      : status === "geplant"
      ? styles.statusGeplant
      : styles.statusAbgelaufen;
  const label =
    status === "aktiv" ? "Aktiv" : status === "geplant" ? "Geplant" : "Abgelaufen";
  return <span className={`${styles.statusBadge} ${cls}`}>{label}</span>;
}

// ── Grouping ─────────────────────────────────────────────────────────────────

interface DocGroup {
  ids: string[];
  retriever_domains: string[];
  titel: string;
  inputType: string;
  original: string; // created_by_input (freitext text or URL)
  status: string;
  gueltig_von: string | null;
  gueltig_bis: string | null;
  created_at: string;
}

function groupDocs(docs: AdminDocument[]): DocGroup[] {
  const map = new Map<string, DocGroup>();

  for (const doc of docs) {
    const minute = doc.created_at.slice(0, 16);
    const key = `${doc.metadata?.created_by_input ?? doc.id}__${minute}`;

    const existing = map.get(key);
    if (existing) {
      existing.ids.push(doc.id);
      for (const d of doc.retriever_domain) {
        if (!existing.retriever_domains.includes(d)) existing.retriever_domains.push(d);
      }
    } else {
      map.set(key, {
        ids: [doc.id],
        retriever_domains: [...doc.retriever_domain],
        titel: doc.metadata?.titel ?? "(Kein Titel)",
        inputType: doc.metadata?.input_type ?? "freitext",
        original: doc.metadata?.created_by_input ?? "",
        status: doc.status,
        gueltig_von: doc.gueltig_von,
        gueltig_bis: doc.gueltig_bis,
        created_at: doc.created_at,
      });
    }
  }

  return Array.from(map.values());
}

// Helper: delete all rows in a group
async function deleteGroupRows(ids: string[]): Promise<boolean> {
  const results = await Promise.all(
    ids.map((id) => fetch(`/api/admin/documents/${id}`, { method: "DELETE" }))
  );
  return results.every((r) => r.ok);
}

// ── Delete dialog ────────────────────────────────────────────────────────────

function DeleteDialog({
  onConfirm,
  onCancel,
  loading,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className={styles.dialogOverlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.dialogTitle}>Eintrag löschen?</h2>
        <p className={styles.dialogBody}>
          Dieser Inhalt wird dauerhaft aus dem BrotBot entfernt. Diese Aktion kann nicht
          rückgängig gemacht werden.
        </p>
        <div className={styles.dialogActions}>
          <button className={styles.cancelBtn} onClick={onCancel} disabled={loading}>
            Abbrechen
          </button>
          <button className={styles.confirmDeleteBtn} onClick={onConfirm} disabled={loading}>
            {loading ? "Löschen ..." : "Löschen"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar entry ────────────────────────────────────────────────────────────

function SidebarEntry({
  group,
  isEditing,
  onEdit,
  onDeleted,
}: {
  group: DocGroup;
  isEditing: boolean;
  onEdit: (group: DocGroup) => void;
  onDeleted: (ids: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const ok = await deleteGroupRows(group.ids);
    if (ok) {
      onDeleted(group.ids);
    } else {
      setDeleting(false);
      setConfirmDelete(false);
      alert("Löschen fehlgeschlagen. Bitte versuche es erneut.");
    }
  }

  return (
    <div className={styles.entry} style={isEditing ? { background: "#fffde6" } : undefined}>
      {confirmDelete && (
        <DeleteDialog
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
          loading={deleting}
        />
      )}

      <div className={styles.entryTop}>
        <span className={styles.entryTitle}>{group.titel}</span>
        <span className={styles.sourceIcon}>
          {group.inputType === "url" ? "URL" : "Freitext"}
        </span>
      </div>

      <div className={styles.entryMeta}>
        {group.retriever_domains.map((d) => (
          <span key={d} className={styles.chip}>
            {RETRIEVER_ABBREV[d] ?? d}
          </span>
        ))}
        <StatusBadge status={group.status} />
      </div>

      <div className={styles.entryDate}>{formatGermanDate(group.created_at)}</div>

      {group.gueltig_bis && (
        <div className={styles.gueltigBis}>
          Gültig bis:{" "}
          {new Date(group.gueltig_bis).toLocaleDateString("de-DE", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </div>
      )}

      <button className={styles.expandBtn} onClick={() => setExpanded((v) => !v)}>
        {expanded ? "Originalinhalt ausblenden" : "Originalinhalt anzeigen"}
      </button>

      {expanded && <div className={styles.originalInput}>{group.original}</div>}

      <div className={styles.entryActions}>
        <button className={styles.editBtn} onClick={() => onEdit(group)}>
          Bearbeiten
        </button>
        <button className={styles.deleteBtn} onClick={() => setConfirmDelete(true)}>
          Löschen
        </button>
      </div>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  docs,
  loading,
  editingGroup,
  onEdit,
  onDeleted,
}: {
  docs: AdminDocument[];
  loading: boolean;
  editingGroup: DocGroup | null;
  onEdit: (group: DocGroup) => void;
  onDeleted: (ids: string[]) => void;
}) {
  const groups = groupDocs(docs);

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <span className={styles.sidebarTitle}>Hinzugefügte Inhalte</span>
        {!loading && <span className={styles.countBadge}>{groups.length}</span>}
      </div>
      <div className={styles.sidebarList}>
        {loading ? (
          [0, 1, 2].map((i) => (
            <div key={i} className={styles.skeletonItem}>
              <div className={styles.skeletonLine} style={{ height: 14, width: "70%" }} />
              <div className={styles.skeletonLine} style={{ height: 12, width: "45%" }} />
              <div className={styles.skeletonLine} style={{ height: 12, width: "30%" }} />
            </div>
          ))
        ) : groups.length === 0 ? (
          <div className={styles.sidebarEmpty}>Noch keine Inhalte hinzugefügt.</div>
        ) : (
          groups.map((group) => (
            <SidebarEntry
              key={group.ids[0]}
              group={group}
              isEditing={editingGroup?.ids[0] === group.ids[0]}
              onEdit={onEdit}
              onDeleted={onDeleted}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Retriever checkbox group ─────────────────────────────────────────────────

function RetrieverCheckboxes({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(slug: string) {
    onChange(
      selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]
    );
  }
  return (
    <div className={styles.retrieverGrid}>
      {RETRIEVER_DOMAINS.map(({ slug, label, hint }) => (
        <label key={slug} className={styles.retrieverRow}>
          <input
            type="checkbox"
            checked={selected.includes(slug)}
            onChange={() => toggle(slug)}
          />
          <div>
            <div className={styles.retrieverLabel}>{label}</div>
            <div className={styles.retrieverHint}>{hint}</div>
          </div>
        </label>
      ))}
    </div>
  );
}

// ── Validity section ─────────────────────────────────────────────────────────

function ValiditySection({
  limited,
  setLimited,
  gueltigVon,
  setGueltigVon,
  gueltigBis,
  setGueltigBis,
}: {
  limited: boolean;
  setLimited: (v: boolean) => void;
  gueltigVon: string;
  setGueltigVon: (v: string) => void;
  gueltigBis: string;
  setGueltigBis: (v: string) => void;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>Gültigkeitszeitraum</span>
      <div className={styles.radioGroup}>
        <label className={styles.radioRow}>
          <input
            type="radio"
            name="validity"
            checked={!limited}
            onChange={() => setLimited(false)}
          />
          <span className={styles.radioLabel}>Dauerhaft gültig</span>
        </label>
        <label className={styles.radioRow}>
          <input
            type="radio"
            name="validity"
            checked={limited}
            onChange={() => setLimited(true)}
          />
          <span className={styles.radioLabel}>Zeitlich begrenzt</span>
        </label>
      </div>
      {limited && (
        <div className={styles.dateRange}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="gueltig-von">
              Gültig ab
            </label>
            <input
              id="gueltig-von"
              type="date"
              className={styles.input}
              value={gueltigVon}
              onChange={(e) => setGueltigVon(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="gueltig-bis">
              Gültig bis
            </label>
            <input
              id="gueltig-bis"
              type="date"
              className={styles.input}
              value={gueltigBis}
              onChange={(e) => setGueltigBis(e.target.value)}
              required={limited}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Freitext tab ─────────────────────────────────────────────────────────────

function FreitextTab({
  editingGroup,
  onCancelEdit,
  onSuccess,
  onEditDone,
}: {
  editingGroup: DocGroup | null;
  onCancelEdit: () => void;
  onSuccess: () => void;
  onEditDone: (ids: string[]) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [text, setText] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [limited, setLimited] = useState(false);
  const [gueltigVon, setGueltigVon] = useState(today);
  const [gueltigBis, setGueltigBis] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  // Pre-fill when entering edit mode; reset when leaving.
  useEffect(() => {
    if (editingGroup) {
      setText(editingGroup.original);
      setDomains(editingGroup.retriever_domains);
      const hasDates = !!editingGroup.gueltig_bis;
      setLimited(hasDates);
      setGueltigVon(editingGroup.gueltig_von ?? today);
      setGueltigBis(editingGroup.gueltig_bis ?? "");
    } else {
      setText("");
      setDomains([]);
      setLimited(false);
      setGueltigVon(today);
      setGueltigBis("");
    }
    setSuccess("");
    setError("");
  }, [editingGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit() {
    if (!text.trim()) return;
    if (domains.length === 0) { setError("Bitte mindestens einen Bereich auswählen."); return; }
    if (limited && !gueltigBis) { setError("Bitte ein Enddatum angeben."); return; }

    setLoading(true);
    setError("");
    setSuccess("");

    // In edit mode: delete old rows first, then ingest fresh.
    if (editingGroup) {
      const deleted = await deleteGroupRows(editingGroup.ids);
      if (!deleted) {
        setError("Alte Einträge konnten nicht gelöscht werden.");
        setLoading(false);
        return;
      }
    }

    const res = await fetch("/api/admin/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        freitext: text.trim(),
        retriever_domains: domains,
        gueltig_von: limited ? gueltigVon || null : null,
        gueltig_bis: limited ? gueltigBis || null : null,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (data.success) {
      if (editingGroup) {
        onEditDone(editingGroup.ids);
      } else {
        setSuccess(`${data.inserted} Eintrag${data.inserted !== 1 ? "e" : ""} erfolgreich hinzugefügt.`);
        setText("");
        setDomains([]);
        setLimited(false);
        setGueltigBis("");
        onSuccess();
      }
    } else {
      setError(data.error ?? "Unbekannter Fehler.");
    }
  }

  const isEditMode = !!editingGroup;

  return (
    <div className={styles.formBody}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="freitext">
          Was soll der BrotBot wissen?
        </label>
        <textarea
          id="freitext"
          className={styles.textarea}
          rows={5}
          placeholder="z.B. Ab Montag, 14. Juli gibt es in allen Filialen das neue Dinkelvollkornbrot. Es ist vegan, laktosefrei und enthält Sonnenblumenkerne."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className={styles.charCount}>{text.length} Zeichen</div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Zu welchem Bereich gehört diese Information?</span>
        <div className={styles.hint}>Mehrfachauswahl möglich – wähle alle passenden Bereiche.</div>
        <RetrieverCheckboxes selected={domains} onChange={setDomains} />
      </div>

      <ValiditySection
        limited={limited}
        setLimited={setLimited}
        gueltigVon={gueltigVon}
        setGueltigVon={setGueltigVon}
        gueltigBis={gueltigBis}
        setGueltigBis={setGueltigBis}
      />

      {error && <div className={styles.errorMsg}>{error}</div>}
      {success && <div className={styles.successMsg}>{success}</div>}

      <button
        className={styles.submitBtn}
        onClick={handleSubmit}
        disabled={loading || !text.trim()}
      >
        {loading
          ? "Wird verarbeitet ..."
          : isEditMode
          ? "Änderungen speichern"
          : "Inhalt hinzufügen"}
      </button>
    </div>
  );
}

// ── URL tab ───────────────────────────────────────────────────────────────────

function UrlTab({
  editingGroup,
  onCancelEdit,
  onSuccess,
  onEditDone,
}: {
  editingGroup: DocGroup | null;
  onCancelEdit: () => void;
  onSuccess: () => void;
  onEditDone: (ids: string[]) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzeError, setAnalyzeError] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [limited, setLimited] = useState(false);
  const [gueltigVon, setGueltigVon] = useState(today);
  const [gueltigBis, setGueltigBis] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [submitError, setSubmitError] = useState("");

  // Pre-fill when entering edit mode; reset when leaving.
  useEffect(() => {
    if (editingGroup) {
      setUrl(editingGroup.original);
      setDomains(editingGroup.retriever_domains);
      const hasDates = !!editingGroup.gueltig_bis;
      setLimited(hasDates);
      setGueltigVon(editingGroup.gueltig_von ?? today);
      setGueltigBis(editingGroup.gueltig_bis ?? "");
      setAnalysis(null);
      setAnalyzeError("");
    } else {
      setUrl("");
      setDomains([]);
      setLimited(false);
      setGueltigVon(today);
      setGueltigBis("");
      setAnalysis(null);
      setAnalyzeError("");
    }
    setSuccess("");
    setSubmitError("");
  }, [editingGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAnalyze() {
    if (!url.trim()) return;
    setAnalyzing(true);
    setAnalyzeError("");
    setAnalysis(null);

    const res = await fetch("/api/admin/analyze-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim() }),
    });

    const data = await res.json();
    setAnalyzing(false);

    if (data.success) {
      setAnalysis(data);
      // In edit mode keep the user's current retriever selection; only set
      // from LLM suggestion when starting fresh.
      if (!editingGroup) {
        setDomains(data.vorgeschlagene_retriever ?? []);
      }
    } else {
      setAnalyzeError(
        data.error ??
          "Diese Seite konnte nicht gelesen werden. Bitte prüfe die URL oder versuche es mit einer anderen Seite."
      );
    }
  }

  async function handleSubmit() {
    if (!analysis) return;
    if (domains.length === 0) { setSubmitError("Bitte mindestens einen Bereich auswählen."); return; }
    if (limited && !gueltigBis) { setSubmitError("Bitte ein Enddatum angeben."); return; }

    setLoading(true);
    setSubmitError("");
    setSuccess("");

    if (editingGroup) {
      const deleted = await deleteGroupRows(editingGroup.ids);
      if (!deleted) {
        setSubmitError("Alte Einträge konnten nicht gelöscht werden.");
        setLoading(false);
        return;
      }
    }

    const res = await fetch("/api/admin/ingest-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url.trim(),
        extracted_text: analysis.extracted_text,
        retriever_domains: domains,
        gueltig_von: limited ? gueltigVon || null : null,
        gueltig_bis: limited ? gueltigBis || null : null,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (data.success) {
      if (editingGroup) {
        onEditDone(editingGroup.ids);
      } else {
        setSuccess(`${data.inserted} Eintrag${data.inserted !== 1 ? "e" : ""} erfolgreich hinzugefügt.`);
        setUrl("");
        setAnalysis(null);
        setDomains([]);
        setLimited(false);
        setGueltigBis("");
        onSuccess();
      }
    } else {
      setSubmitError(data.error ?? "Unbekannter Fehler.");
    }
  }

  const isEditMode = !!editingGroup;

  return (
    <div className={styles.formBody}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="url-input">
          URL einer Webseite einfügen
        </label>
        <input
          id="url-input"
          type="url"
          className={styles.input}
          placeholder="https://www.beispiel.de/artikel-ueber-sauerteig"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setAnalysis(null);
            setAnalyzeError("");
          }}
        />
        <div className={styles.hint}>
          Der BrotBot liest den Inhalt dieser Seite und schlägt passende Wissensbereiche vor.
        </div>
        <div className={styles.legal}>
          Bitte nur Seiten einfügen, deren Inhalte öffentlich zugänglich und zur Nutzung bestimmt
          sind.
        </div>
      </div>

      <button
        className={styles.analyzeBtn}
        onClick={handleAnalyze}
        disabled={analyzing || !url.trim()}
      >
        {analyzing ? "Seite wird gelesen ..." : "Seite analysieren"}
      </button>

      {analyzeError && <div className={styles.errorMsg}>{analyzeError}</div>}

      {/* In edit mode, show retrievers + validity even before re-analysis */}
      {(analysis || isEditMode) && (
        <>
          {analysis && (
            <div className={styles.analysisResult}>
              <div className={styles.analysisTitle}>{analysis.titel}</div>
              <div className={styles.analysisSummary}>{analysis.zusammenfassung}</div>
            </div>
          )}

          {isEditMode && !analysis && (
            <div className={styles.hint} style={{ fontStyle: "italic" }}>
              Klicke auf „Seite analysieren", um den aktuellen Seiteninhalt neu zu laden.
              Die Bereichsauswahl bleibt erhalten.
            </div>
          )}

          <div className={styles.field}>
            <span className={styles.label}>Zu welchem Bereich gehört diese Information?</span>
            <div className={styles.hint}>
              {analysis && !isEditMode
                ? "Der BrotBot hat folgende Bereiche vorgeschlagen. Du kannst die Auswahl anpassen."
                : "Mehrfachauswahl möglich – wähle alle passenden Bereiche."}
            </div>
            <RetrieverCheckboxes selected={domains} onChange={setDomains} />
          </div>

          <ValiditySection
            limited={limited}
            setLimited={setLimited}
            gueltigVon={gueltigVon}
            setGueltigVon={setGueltigVon}
            gueltigBis={gueltigBis}
            setGueltigBis={setGueltigBis}
          />

          {submitError && <div className={styles.errorMsg}>{submitError}</div>}
          {success && <div className={styles.successMsg}>{success}</div>}

          <button
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={loading || domains.length === 0 || (!analysis && !isEditMode)}
          >
            {loading
              ? "Wird verarbeitet ..."
              : isEditMode
              ? "Änderungen speichern"
              : "Inhalt hinzufügen"}
          </button>
        </>
      )}

      {success && !analysis && !isEditMode && (
        <div className={styles.successMsg}>{success}</div>
      )}
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function AdminDashboard({ userEmail }: { userEmail: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"freitext" | "url">("freitext");
  const [docs, setDocs] = useState<AdminDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [editingGroup, setEditingGroup] = useState<DocGroup | null>(null);
  const formPanelRef = useRef<HTMLDivElement>(null);

  const fetchDocs = useCallback(async () => {
    setDocsLoading(true);
    const res = await fetch("/api/admin/documents");
    if (res.ok) {
      const data = await res.json();
      setDocs(data.documents ?? []);
    }
    setDocsLoading(false);
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  // When edit mode starts: switch to the right tab and scroll form into view.
  useEffect(() => {
    if (editingGroup) {
      setTab(editingGroup.inputType === "url" ? "url" : "freitext");
      formPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [editingGroup]);

  function handleDocDeleted(ids: string[]) {
    setDocs((prev) => prev.filter((d) => !ids.includes(d.id)));
    // Clear edit mode if the entry being edited was deleted.
    setEditingGroup((eg) =>
      eg && eg.ids.some((id) => ids.includes(id)) ? null : eg
    );
  }

  function handleEditDone(deletedIds: string[]) {
    // Remove old rows, clear edit mode, then refresh sidebar to show new rows.
    setDocs((prev) => prev.filter((d) => !deletedIds.includes(d.id)));
    setEditingGroup(null);
    fetchDocs();
  }

  function handleCancelEdit() {
    setEditingGroup(null);
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <img
          src="https://baeckerei-mueller-chiemgau.de/wp-content/uploads/2023/07/baeckerei-mueller-logo.svg"
          alt="Bäckerei Müller"
          className={styles.headerLogo}
        />
        <span className={styles.headerTitle}>BrotBot Admin</span>
        <span className={styles.headerSpacer} />
        <span className={styles.headerUser}>{userEmail}</span>
        <button className={styles.logoutBtn} onClick={handleLogout}>
          Abmelden
        </button>
      </header>

      <div className={styles.content}>
        {/* Left: input form */}
        <div className={styles.formPanel} ref={formPanelRef}>
          <h1 className={styles.formPanelTitle}>
            {editingGroup ? "Inhalt bearbeiten" : "Neuen Inhalt hinzufügen"}
          </h1>

          {editingGroup && (
            <div className={styles.editBanner}>
              <span className={styles.editBannerLabel}>
                Bearbeitungsmodus — „{editingGroup.titel}"
              </span>
              <button className={styles.cancelLink} onClick={handleCancelEdit}>
                Abbrechen
              </button>
            </div>
          )}

          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${tab === "freitext" ? styles.tabActive : ""}`}
              onClick={() => setTab("freitext")}
              disabled={!!editingGroup}
            >
              Freitext
            </button>
            <button
              className={`${styles.tab} ${tab === "url" ? styles.tabActive : ""}`}
              onClick={() => setTab("url")}
              disabled={!!editingGroup}
            >
              URL
            </button>
          </div>

          {tab === "freitext" ? (
            <FreitextTab
              editingGroup={editingGroup?.inputType === "freitext" ? editingGroup : null}
              onCancelEdit={handleCancelEdit}
              onSuccess={fetchDocs}
              onEditDone={handleEditDone}
            />
          ) : (
            <UrlTab
              editingGroup={editingGroup?.inputType === "url" ? editingGroup : null}
              onCancelEdit={handleCancelEdit}
              onSuccess={fetchDocs}
              onEditDone={handleEditDone}
            />
          )}
        </div>

        {/* Right: activity sidebar */}
        <Sidebar
          docs={docs}
          loading={docsLoading}
          editingGroup={editingGroup}
          onEdit={setEditingGroup}
          onDeleted={handleDocDeleted}
        />
      </div>
    </div>
  );
}
