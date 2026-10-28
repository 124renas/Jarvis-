// On-device equivalents of the server's data access layer (same ordering and
// semantics, so the UI behaves identically in both editions).
import { table } from "./idb";
import type { CalendarEvent, Memory, Note, Task } from "../lib/types";

export interface StoredConversation {
  id: number;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface StoredMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  meta: Record<string, any>;
  created_at: number;
}

type StoredTask = Task & { notified?: boolean };

export const conversations = table<StoredConversation>("conversations");
export const messages = table<StoredMessage>("messages");
export const tasksTable = table<StoredTask>("tasks");
export const eventsTable = table<CalendarEvent & { created_at: number }>("events");
export const notesTable = table<Note>("notes");
export const memoriesTable = table<Memory>("memories");

const PRIO = { high: 0, medium: 1, low: 2 } as const;

export async function listTasks(includeDone = false): Promise<Task[]> {
  const all = await tasksTable.all();
  return all
    .filter((t) => includeDone || !t.done)
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        PRIO[a.priority] - PRIO[b.priority] ||
        (a.due_at == null ? 1 : 0) - (b.due_at == null ? 1 : 0) ||
        (a.due_at ?? 0) - (b.due_at ?? 0) ||
        b.id - a.id,
    );
}

export function createTask(t: { title: string; notes?: string; priority?: Task["priority"]; due_at?: number | null }) {
  return tasksTable.put({
    title: t.title,
    notes: t.notes ?? "",
    priority: t.priority ?? "medium",
    due_at: t.due_at ?? null,
    done: false,
    created_at: Date.now(),
  });
}

export async function updateTask(id: number, patch: Partial<Task>) {
  const current = await tasksTable.get(id);
  if (!current) return undefined;
  return tasksTable.put({ ...current, ...patch, id });
}

export async function listEvents(from = 0, to = Number.MAX_SAFE_INTEGER) {
  const all = await eventsTable.all();
  return all.filter((e) => (e.end_at ?? e.start_at) >= from && e.start_at <= to).sort((a, b) => a.start_at - b.start_at);
}

export function createEvent(e: { title: string; start_at: number; end_at?: number | null; all_day?: boolean; location?: string; notes?: string }) {
  return eventsTable.put({
    title: e.title,
    start_at: e.start_at,
    end_at: e.end_at ?? null,
    all_day: !!e.all_day,
    location: e.location ?? "",
    notes: e.notes ?? "",
    created_at: Date.now(),
  });
}

export async function listNotes(query = ""): Promise<Note[]> {
  const q = query.trim().toLowerCase();
  const all = await notesTable.all();
  return all
    .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
    .sort((a, b) => b.updated_at - a.updated_at);
}

export function createNote(n: { title: string; body?: string }) {
  const t = Date.now();
  return notesTable.put({ title: n.title, body: n.body ?? "", created_at: t, updated_at: t });
}

export async function listMemories(): Promise<Memory[]> {
  return (await memoriesTable.all()).sort((a, b) => a.id - b.id);
}

export async function conversationMessages(conversationId: number): Promise<StoredMessage[]> {
  return (await messages.all()).filter((m) => m.conversation_id === conversationId).sort((a, b) => a.id - b.id);
}

export async function deleteConversation(id: number) {
  for (const m of await conversationMessages(id)) await messages.delete(m.id);
  await conversations.delete(id);
}
