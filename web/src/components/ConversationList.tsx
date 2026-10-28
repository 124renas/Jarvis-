import { useState } from "react";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { haptic } from "../lib/haptics";

export function ConversationList({ onPicked }: { onPicked?(): void }) {
  const { conversations, refreshConversations, activeId, setActiveId, setView, confirm, toast } = useApp();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const list = query.trim()
    ? conversations.filter((c) => (c.title + " " + (c.preview ?? "")).toLowerCase().includes(query.toLowerCase()))
    : conversations;

  const open = (id: number | null) => {
    setActiveId(id);
    setView("assistant");
    onPicked?.();
  };

  const rename = async (id: number) => {
    const title = draft.trim();
    setEditing(null);
    if (!title) return;
    try {
      await api(`/conversations/${id}`, { method: "PATCH", body: { title } });
      await refreshConversations();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async (id: number, title: string) => {
    const ok = await confirm({ title: "Delete conversation?", body: `“${title}” will be permanently deleted.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api(`/conversations/${id}`, { method: "DELETE" });
      haptic("warning");
      if (activeId === id) setActiveId(null);
      await refreshConversations();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="conv-list">
      <button type="button" className="btn primary block" onClick={() => open(null)}>
        <Icon name="plus" size={18} /> New conversation
      </button>
      <label className="search">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Search conversations" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search conversations" />
      </label>
      {list.length === 0 && <p className="muted small pad">{query ? "No matching conversations." : "No conversations yet. Say hello to JARVIS."}</p>}
      <ul>
        {list.map((c) => (
          <li key={c.id} className={c.id === activeId ? "active" : ""}>
            {editing === c.id ? (
              <form
                className="conv-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename(c.id);
                }}
              >
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => rename(c.id)} aria-label="Conversation title" maxLength={120} />
              </form>
            ) : (
              <button type="button" className="conv-item" onClick={() => open(c.id)}>
                <span className="conv-title">{c.title}</span>
                {c.preview && <span className="conv-preview">{c.preview.replace(/[#*_`>]/g, "")}</span>}
              </button>
            )}
            <div className="conv-actions">
              <button
                type="button"
                className="icon-btn small"
                aria-label={`Rename ${c.title}`}
                onClick={() => {
                  setDraft(c.title);
                  setEditing(c.id);
                }}
              >
                <Icon name="edit" size={16} />
              </button>
              <button type="button" className="icon-btn small" aria-label={`Delete ${c.title}`} onClick={() => remove(c.id, c.title)}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
