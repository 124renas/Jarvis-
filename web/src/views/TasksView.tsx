import { useState } from "react";
import { Icon } from "../components/Icon";
import { EmptyState, ErrorState, PageHeader, Sheet, Spinner } from "../components/ui";
import { api, download, STANDALONE } from "../lib/api";
import { fromLocalInput, relativeDue, toLocalInput } from "../lib/format";
import { haptic } from "../lib/haptics";
import { useApp, useData } from "../lib/store";
import type { ParsedItem, Task } from "../lib/types";

const PRIORITIES: Task["priority"][] = ["high", "medium", "low"];

export function TasksView() {
  const { toast, bump, online } = useApp();
  const [showDone, setShowDone] = useState(false);
  const { data, setData, loading, error, reload } = useData<{ tasks: Task[] }>(`/tasks${showDone ? "?all=1" : ""}`, "tasks", { tasks: [] });
  const [quick, setQuick] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Partial<Task> | null>(null);

  const tasks = data.tasks;

  const quickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = quick.trim();
    if (!text) return;
    setAdding(true);
    try {
      // JARVIS turns natural language ("call mum tomorrow 5pm, urgent") into a structured task.
      const { item } = await api<{ item: ParsedItem }>("/assist/parse", { body: { text, kind: "task" } });
      await api("/tasks", { body: { title: item.title, priority: item.priority, due_at: item.at, notes: item.notes } });
      setQuick("");
      haptic("success");
      bump("tasks");
      toast(`Task added: ${item.title}`, "success");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (t: Task) => {
    haptic(t.done ? "light" : "success");
    setData({ tasks: tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) });
    try {
      await api(`/tasks/${t.id}`, { method: "PATCH", body: { done: !t.done } });
      bump("tasks");
    } catch (err) {
      toast((err as Error).message, "error");
      reload();
    }
  };

  const save = async (t: Partial<Task>) => {
    try {
      const body = { title: t.title, priority: t.priority, due_at: t.due_at ?? null, notes: t.notes ?? "" };
      if (t.id) await api(`/tasks/${t.id}`, { method: "PATCH", body });
      else await api("/tasks", { body });
      setEditing(null);
      bump("tasks");
      haptic("success");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const remove = async (t: Partial<Task>) => {
    if (!t.id) return;
    try {
      await api(`/tasks/${t.id}`, { method: "DELETE" });
      setEditing(null);
      bump("tasks");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const open = tasks.filter((t) => !t.done);
  const upcoming = open.filter((t) => t.due_at != null).sort((a, b) => a.due_at! - b.due_at!).slice(0, 3);

  return (
    <section className="page" aria-label="Tasks">
      <PageHeader
        title="Tasks"
        subtitle={`${open.length} open`}
        actions={
          <button type="button" className="btn primary" onClick={() => setEditing({ priority: "medium", title: "" })}>
            <Icon name="plus" size={18} /> New
          </button>
        }
      />

      <form className="quick-add glass" onSubmit={quickAdd}>
        <Icon name="sparkle" size={18} />
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="e.g. Call the bank tomorrow at 10am, urgent"
          aria-label="Add a task in natural language"
          enterKeyHint="done"
          disabled={adding}
        />
        <button type="submit" className="btn small primary" disabled={adding || !quick.trim() || !online}>
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      {upcoming.length > 0 && (
        <div className="upcoming glass">
          <p className="eyebrow">Up next</p>
          {upcoming.map((t) => (
            <p key={t.id} className={`due-${relativeDue(t.due_at).tone}`}>
              <strong>{t.title}</strong> · {relativeDue(t.due_at).text}
            </p>
          ))}
        </div>
      )}

      <div className="row-between">
        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={!showDone} className={!showDone ? "on" : ""} onClick={() => setShowDone(false)}>
            Open
          </button>
          <button type="button" role="tab" aria-selected={showDone} className={showDone ? "on" : ""} onClick={() => setShowDone(true)}>
            All
          </button>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : tasks.length === 0 ? (
        <EmptyState icon="tasks" title="No tasks yet">
          Add one above, or just tell JARVIS: “Remind me to renew my passport next Friday.”
        </EmptyState>
      ) : (
        PRIORITIES.map((p) => {
          const group = tasks.filter((t) => t.priority === p);
          if (!group.length) return null;
          return (
            <div key={p} className="task-group">
              <h2 className={`group-title prio-${p}`}>{p} priority</h2>
              <ul className="task-list">
                {group.map((t) => {
                  const due = relativeDue(t.due_at);
                  return (
                    <li key={t.id} className={`task glass ${t.done ? "done" : ""}`}>
                      <button
                        type="button"
                        className={`check ${t.done ? "checked" : ""}`}
                        onClick={() => toggle(t)}
                        aria-label={t.done ? `Mark ${t.title} as not done` : `Complete ${t.title}`}
                      >
                        {t.done && <Icon name="check" size={16} />}
                      </button>
                      <button type="button" className="task-main" onClick={() => setEditing(t)}>
                        <span className="task-title">{t.title}</span>
                        {t.due_at != null && <span className={`task-due due-${due.tone}`}>{due.text}</span>}
                        {t.notes && <span className="task-notes">{t.notes}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}

      {editing && (
        <TaskSheet
          task={editing}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={remove}
          onExport={(t) => download(`/api/tasks/${t.id}/ics`)}
        />
      )}
    </section>
  );
}

function TaskSheet({
  task,
  onClose,
  onSave,
  onDelete,
  onExport,
}: {
  task: Partial<Task>;
  onClose(): void;
  onSave(t: Partial<Task>): void;
  onDelete(t: Partial<Task>): void;
  onExport(t: Partial<Task>): void;
}) {
  const [t, setT] = useState(task);
  return (
    <Sheet title={t.id ? "Edit task" : "New task"} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (t.title?.trim()) onSave(t);
        }}
      >
        <label>
          Title
          <input value={t.title ?? ""} onChange={(e) => setT({ ...t, title: e.target.value })} required maxLength={300} />
        </label>
        <label>
          Priority
          <select value={t.priority} onChange={(e) => setT({ ...t, priority: e.target.value as Task["priority"] })}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label>
          Due
          <input type="datetime-local" value={toLocalInput(t.due_at ?? null)} onChange={(e) => setT({ ...t, due_at: fromLocalInput(e.target.value) })} />
        </label>
        <label>
          Notes
          <textarea rows={3} value={t.notes ?? ""} onChange={(e) => setT({ ...t, notes: e.target.value })} />
        </label>
        <p className="small muted">{STANDALONE ? "Tip: tap Calendar to add a due task to Apple Calendar so iOS reminds you." : "With notifications enabled, JARVIS alerts you when a task is due."}</p>
        <div className="row-between">
          <div className="row">
            {t.id && (
              <button type="button" className="btn danger ghost" onClick={() => onDelete(t)}>
                <Icon name="trash" size={18} /> Delete
              </button>
            )}
            {t.id && t.due_at && (
              <button type="button" className="btn ghost" onClick={() => onExport(t)} title="Add to Apple Calendar">
                <Icon name="calendar" size={18} /> Calendar
              </button>
            )}
          </div>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}
