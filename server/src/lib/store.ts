// Data access for productivity records. Every query is scoped by user_id so
// one account can never read or change another account's data.
import type { DB } from "../db.js";
import { now } from "../db.js";

export type Priority = "low" | "medium" | "high";

export interface Task {
  id: number;
  title: string;
  notes: string;
  priority: Priority;
  due_at: number | null;
  done: boolean;
  created_at: number;
}

export interface CalendarEvent {
  id: number;
  title: string;
  start_at: number;
  end_at: number | null;
  all_day: boolean;
  location: string;
  notes: string;
  created_at: number;
}

export interface Note {
  id: number;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

export interface Memory {
  id: number;
  content: string;
  category: string;
  created_at: number;
}

const toTask = (r: any): Task => ({
  id: r.id,
  title: r.title,
  notes: r.notes,
  priority: r.priority,
  due_at: r.due_at ?? null,
  done: !!r.done,
  created_at: r.created_at,
});

const toEvent = (r: any): CalendarEvent => ({
  id: r.id,
  title: r.title,
  start_at: r.start_at,
  end_at: r.end_at ?? null,
  all_day: !!r.all_day,
  location: r.location,
  notes: r.notes,
  created_at: r.created_at,
});

// ---- Tasks ----

export function listTasks(db: DB, userId: number, opts: { includeDone?: boolean } = {}): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM tasks WHERE user_id = ? ${opts.includeDone ? "" : "AND done = 0"}
       ORDER BY done ASC, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                due_at IS NULL, due_at ASC, id DESC`,
    )
    .all(userId);
  return rows.map(toTask);
}

export function getTask(db: DB, userId: number, id: number): Task | undefined {
  const r = db.prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?").get(id, userId);
  return r ? toTask(r) : undefined;
}

export function createTask(
  db: DB,
  userId: number,
  t: { title: string; notes?: string; priority?: Priority; due_at?: number | null },
): Task {
  const info = db
    .prepare("INSERT INTO tasks (user_id, title, notes, priority, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(userId, t.title, t.notes ?? "", t.priority ?? "medium", t.due_at ?? null, now());
  return getTask(db, userId, Number(info.lastInsertRowid))!;
}

export function updateTask(db: DB, userId: number, id: number, patch: Partial<Omit<Task, "id" | "created_at">>) {
  const current = getTask(db, userId, id);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  const dueChanged = patch.due_at !== undefined && patch.due_at !== current.due_at;
  db.prepare(
    `UPDATE tasks SET title = ?, notes = ?, priority = ?, due_at = ?, done = ?, notified = CASE WHEN ? THEN 0 ELSE notified END
     WHERE id = ? AND user_id = ?`,
  ).run(next.title, next.notes, next.priority, next.due_at, next.done ? 1 : 0, dueChanged ? 1 : 0, id, userId);
  return getTask(db, userId, id);
}

export function deleteTask(db: DB, userId: number, id: number): boolean {
  return db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

// ---- Events ----

export function listEvents(db: DB, userId: number, from?: number, to?: number): CalendarEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM events WHERE user_id = ? AND COALESCE(end_at, start_at) >= ? AND start_at <= ? ORDER BY start_at ASC`,
    )
    .all(userId, from ?? 0, to ?? Number.MAX_SAFE_INTEGER);
  return rows.map(toEvent);
}

export function getEvent(db: DB, userId: number, id: number): CalendarEvent | undefined {
  const r = db.prepare("SELECT * FROM events WHERE id = ? AND user_id = ?").get(id, userId);
  return r ? toEvent(r) : undefined;
}

export function createEvent(
  db: DB,
  userId: number,
  e: { title: string; start_at: number; end_at?: number | null; all_day?: boolean; location?: string; notes?: string },
): CalendarEvent {
  const info = db
    .prepare(
      "INSERT INTO events (user_id, title, start_at, end_at, all_day, location, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(userId, e.title, e.start_at, e.end_at ?? null, e.all_day ? 1 : 0, e.location ?? "", e.notes ?? "", now());
  return getEvent(db, userId, Number(info.lastInsertRowid))!;
}

export function updateEvent(db: DB, userId: number, id: number, patch: Partial<Omit<CalendarEvent, "id" | "created_at">>) {
  const current = getEvent(db, userId, id);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  db.prepare(
    `UPDATE events SET title = ?, start_at = ?, end_at = ?, all_day = ?, location = ?, notes = ?, notified = CASE WHEN ? THEN 0 ELSE notified END
     WHERE id = ? AND user_id = ?`,
  ).run(
    next.title,
    next.start_at,
    next.end_at,
    next.all_day ? 1 : 0,
    next.location,
    next.notes,
    next.start_at !== current.start_at ? 1 : 0,
    id,
    userId,
  );
  return getEvent(db, userId, id);
}

export function deleteEvent(db: DB, userId: number, id: number): boolean {
  return db.prepare("DELETE FROM events WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

// ---- Notes ----

export function listNotes(db: DB, userId: number, query?: string): Note[] {
  if (query?.trim()) {
    const like = `%${query.trim().replace(/[%_\\]/g, (c) => "\\" + c)}%`;
    return db
      .prepare(
        "SELECT * FROM notes WHERE user_id = ? AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') ORDER BY updated_at DESC",
      )
      .all(userId, like, like) as unknown as Note[];
  }
  return db.prepare("SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as unknown as Note[];
}

export function getNote(db: DB, userId: number, id: number): Note | undefined {
  return db.prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?").get(id, userId) as Note | undefined;
}

export function createNote(db: DB, userId: number, n: { title: string; body?: string }): Note {
  const t = now();
  const info = db
    .prepare("INSERT INTO notes (user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, n.title, n.body ?? "", t, t);
  return getNote(db, userId, Number(info.lastInsertRowid))!;
}

export function updateNote(db: DB, userId: number, id: number, patch: { title?: string; body?: string }) {
  const current = getNote(db, userId, id);
  if (!current) return undefined;
  db.prepare("UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(
    patch.title ?? current.title,
    patch.body ?? current.body,
    now(),
    id,
    userId,
  );
  return getNote(db, userId, id);
}

export function deleteNote(db: DB, userId: number, id: number): boolean {
  return db.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

// ---- Memories ----

export function listMemories(db: DB, userId: number): Memory[] {
  return db.prepare("SELECT * FROM memories WHERE user_id = ? ORDER BY id ASC").all(userId) as unknown as Memory[];
}

export function createMemory(db: DB, userId: number, m: { content: string; category?: string }): Memory {
  const info = db
    .prepare("INSERT INTO memories (user_id, content, category, created_at) VALUES (?, ?, ?, ?)")
    .run(userId, m.content, m.category ?? "preference", now());
  return db.prepare("SELECT * FROM memories WHERE id = ?").get(Number(info.lastInsertRowid)) as unknown as Memory;
}

export function updateMemory(db: DB, userId: number, id: number, patch: { content?: string; category?: string }) {
  const current = db.prepare("SELECT * FROM memories WHERE id = ? AND user_id = ?").get(id, userId) as Memory | undefined;
  if (!current) return undefined;
  db.prepare("UPDATE memories SET content = ?, category = ? WHERE id = ? AND user_id = ?").run(
    patch.content ?? current.content,
    patch.category ?? current.category,
    id,
    userId,
  );
  return { ...current, ...patch };
}

export function deleteMemory(db: DB, userId: number, id: number): boolean {
  return db.prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}
