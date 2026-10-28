import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../components/ui";
import { api, download } from "../lib/api";
import { fmtShort } from "../lib/format";
import { haptic } from "../lib/haptics";
import { useApp, useData } from "../lib/store";
import type { Note } from "../lib/types";

export function NotesView({ compact }: { compact: boolean }) {
  const { toast, bump, confirm, setView, setActiveId, setPendingPrompt, online } = useApp();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const { data, loading, error, reload } = useData<{ notes: Note[] }>(`/notes?q=${encodeURIComponent(debounced)}`, "notes", { notes: [] });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [summary, setSummary] = useState<string | null>(null);
  const [summarising, setSummarising] = useState(false);
  const [preview, setPreview] = useState(false);
  const saveTimer = useRef<number>(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const selected = data.notes.find((n) => n.id === selectedId) ?? null;

  useEffect(() => {
    if (selected && (!draft || selectedId !== selected.id)) setDraft({ title: selected.title, body: selected.body });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.id]);

  const persist = async (id: number, d: { title: string; body: string }) => {
    setSaving("saving");
    try {
      await api(`/notes/${id}`, { method: "PATCH", body: { title: d.title.trim() || "Untitled", body: d.body } });
      setSaving("saved");
      bump("notes");
    } catch (e) {
      setSaving("idle");
      toast((e as Error).message, "error");
    }
  };

  const edit = (patch: Partial<{ title: string; body: string }>) => {
    if (!draft || selectedId == null) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    setSaving("idle");
    clearTimeout(saveTimer.current);
    const id = selectedId;
    saveTimer.current = window.setTimeout(() => persist(id, next), 700);
  };

  const create = async () => {
    try {
      const { note } = await api<{ note: Note }>("/notes", { body: { title: "New note", body: "" } });
      bump("notes");
      setQuery("");
      setSelectedId(note.id);
      setDraft({ title: note.title, body: "" });
      setSummary(null);
      setPreview(false);
      haptic("light");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async () => {
    if (selectedId == null || !draft) return;
    const ok = await confirm({ title: "Delete note?", body: `“${draft.title}” will be permanently deleted.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    clearTimeout(saveTimer.current);
    await api(`/notes/${selectedId}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
    setSelectedId(null);
    setDraft(null);
    bump("notes");
  };

  const summarise = async () => {
    if (!draft?.body.trim()) {
      toast("This note is empty.");
      return;
    }
    setSummarising(true);
    setSummary(null);
    try {
      const { text } = await api<{ text: string }>("/assist/summarize", { body: { text: `${draft.title}\n\n${draft.body}` } });
      setSummary(text);
      haptic("success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSummarising(false);
    }
  };

  const openNote = (n: Note) => {
    clearTimeout(saveTimer.current);
    setSelectedId(n.id);
    setDraft({ title: n.title, body: n.body });
    setSummary(null);
    setSaving("idle");
    setPreview(false);
  };

  const showList = !compact || selectedId == null;
  const showEditor = selectedId != null && draft;

  return (
    <section className="page notes-page" aria-label="Notes">
      {showList && (
        <PageHeader
          title="Notes"
          subtitle={`${data.notes.length} note${data.notes.length === 1 ? "" : "s"}`}
          actions={
            <>
              <button type="button" className="btn ghost" onClick={() => download("/api/export/notes.md")} aria-label="Export notes as Markdown">
                <Icon name="download" size={18} /> Export
              </button>
              <button type="button" className="btn primary" onClick={create}>
                <Icon name="plus" size={18} /> New
              </button>
            </>
          }
        />
      )}

      <div className={`notes-layout ${showEditor ? "has-editor" : ""}`}>
        {showList && (
          <div className="notes-list">
            <label className="search">
              <Icon name="search" size={16} />
              <input type="search" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
            </label>
            {loading ? (
              <Spinner />
            ) : error ? (
              <ErrorState message={error} onRetry={reload} />
            ) : data.notes.length === 0 ? (
              <EmptyState icon="notes" title={query ? "No matches" : "No notes yet"}>
                {query ? "Try another search." : "Create one, or say “JARVIS, take a note…”."}
              </EmptyState>
            ) : (
              <ul>
                {data.notes.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={`note-item glass ${n.id === selectedId ? "active" : ""}`} onClick={() => openNote(n)}>
                      <span className="note-title">{n.title}</span>
                      <span className="note-snippet">{n.body.slice(0, 120) || "Empty note"}</span>
                      <span className="note-date">{fmtShort(n.updated_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {showEditor && (
          <div className="note-editor glass">
            <div className="editor-bar">
              {compact && (
                <button type="button" className="icon-btn" onClick={() => setSelectedId(null)} aria-label="Back to notes">
                  <Icon name="left" />
                </button>
              )}
              <span className="small muted save-state" aria-live="polite">
                {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : ""}
              </span>
              <div className="row">
                <button type="button" className={`btn small ghost ${preview ? "on" : ""}`} onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
                  {preview ? "Edit" : "Preview"}
                </button>
                <button type="button" className="btn small" onClick={summarise} disabled={summarising || !online}>
                  <Icon name="sparkle" size={16} /> {summarising ? "Summarising…" : "Summarise"}
                </button>
                <button type="button" className="icon-btn small" onClick={remove} aria-label="Delete note">
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </div>
            <input className="note-title-input" value={draft!.title} onChange={(e) => edit({ title: e.target.value })} aria-label="Note title" maxLength={300} />
            {preview ? (
              <div className="note-preview">
                <Markdown text={draft!.body || "_Empty note_"} />
              </div>
            ) : (
              <textarea className="note-body" value={draft!.body} onChange={(e) => edit({ body: e.target.value })} placeholder="Write in Markdown…" aria-label="Note body" />
            )}
            {summary && (
              <div className="summary glass">
                <p className="eyebrow">AI summary</p>
                <Markdown text={summary} />
                <div className="row">
                  <button type="button" className="btn small" onClick={() => edit({ body: `${draft!.body}\n\n## Summary\n\n${summary}` })}>
                    Append to note
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => {
                      setActiveId(null);
                      setPendingPrompt({ text: `About my note “${draft!.title}”:\n\n${draft!.body.slice(0, 20000)}\n\n`, send: false });
                      setView("assistant");
                    }}
                  >
                    Discuss with JARVIS
                  </button>
                  <button type="button" className="icon-btn small" onClick={() => setSummary(null)} aria-label="Close summary">
                    <Icon name="close" size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {!showEditor && !compact && (
          <div className="note-editor placeholder glass">
            <EmptyState icon="notes" title="Select a note">
              Choose a note to view or edit it.
            </EmptyState>
          </div>
        )}
      </div>
    </section>
  );
}
