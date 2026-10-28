import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db.js";
import * as store from "../lib/store.js";
import { idParam, notFound, parseBody } from "../lib/http.js";

const ms = z.number().int().nonnegative();

const TaskInput = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(10_000).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  due_at: ms.nullable().optional(),
});
const TaskPatch = TaskInput.partial().extend({ done: z.boolean().optional() });

const EventInput = z.object({
  title: z.string().trim().min(1).max(300),
  start_at: ms,
  end_at: ms.nullable().optional(),
  all_day: z.boolean().optional(),
  location: z.string().max(300).optional(),
  notes: z.string().max(10_000).optional(),
});

const NoteInput = z.object({ title: z.string().trim().min(1).max(300), body: z.string().max(200_000).optional() });
const MemoryInput = z.object({
  content: z.string().trim().min(1).max(500),
  category: z.enum(["preference", "fact", "instruction", "tool"]).optional(),
});

export function dataRoutes(db: DB) {
  const r = Router();
  const uid = (req: any) => req.user.id as number;

  // Tasks
  r.get("/tasks", (req, res) => res.json({ tasks: store.listTasks(db, uid(req), { includeDone: req.query.all === "1" }) }));
  r.post("/tasks", (req, res) => res.status(201).json({ task: store.createTask(db, uid(req), parseBody(TaskInput, req.body)) }));
  r.patch("/tasks/:id", (req, res) => {
    const task = store.updateTask(db, uid(req), idParam(req), parseBody(TaskPatch, req.body));
    if (!task) notFound("Task");
    res.json({ task });
  });
  r.delete("/tasks/:id", (req, res) => {
    if (!store.deleteTask(db, uid(req), idParam(req))) notFound("Task");
    res.json({ ok: true });
  });

  // Events
  r.get("/events", (req, res) => {
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;
    res.json({ events: store.listEvents(db, uid(req), from, to) });
  });
  r.post("/events", (req, res) => res.status(201).json({ event: store.createEvent(db, uid(req), parseBody(EventInput, req.body)) }));
  r.patch("/events/:id", (req, res) => {
    const event = store.updateEvent(db, uid(req), idParam(req), parseBody(EventInput.partial(), req.body));
    if (!event) notFound("Event");
    res.json({ event });
  });
  r.delete("/events/:id", (req, res) => {
    if (!store.deleteEvent(db, uid(req), idParam(req))) notFound("Event");
    res.json({ ok: true });
  });

  // Notes
  r.get("/notes", (req, res) => res.json({ notes: store.listNotes(db, uid(req), String(req.query.q ?? "")) }));
  r.get("/notes/:id", (req, res) => {
    const note = store.getNote(db, uid(req), idParam(req));
    if (!note) notFound("Note");
    res.json({ note });
  });
  r.post("/notes", (req, res) => res.status(201).json({ note: store.createNote(db, uid(req), parseBody(NoteInput, req.body)) }));
  r.patch("/notes/:id", (req, res) => {
    const note = store.updateNote(db, uid(req), idParam(req), parseBody(NoteInput.partial(), req.body));
    if (!note) notFound("Note");
    res.json({ note });
  });
  r.delete("/notes/:id", (req, res) => {
    if (!store.deleteNote(db, uid(req), idParam(req))) notFound("Note");
    res.json({ ok: true });
  });

  // Memories (only ever created by the user, or by the user approving a proposal)
  r.get("/memories", (req, res) => res.json({ memories: store.listMemories(db, uid(req)) }));
  r.post("/memories", (req, res) => res.status(201).json({ memory: store.createMemory(db, uid(req), parseBody(MemoryInput, req.body)) }));
  r.patch("/memories/:id", (req, res) => {
    const memory = store.updateMemory(db, uid(req), idParam(req), parseBody(MemoryInput.partial(), req.body));
    if (!memory) notFound("Memory");
    res.json({ memory });
  });
  r.delete("/memories/:id", (req, res) => {
    if (!store.deleteMemory(db, uid(req), idParam(req))) notFound("Memory");
    res.json({ ok: true });
  });
  r.delete("/memories", (req, res) => {
    db.prepare("DELETE FROM memories WHERE user_id = ?").run(uid(req));
    res.json({ ok: true });
  });

  return r;
}
