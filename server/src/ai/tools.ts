import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { DB } from "../db.js";
import * as store from "../lib/store.js";
import { isoInZone, parseUserDate } from "../lib/time.js";

type ToolDef = Anthropic.Beta.BetaTool;

const nullableString = (description: string) => ({ type: ["string", "null"], description });

function tool(name: string, description: string, properties: Record<string, unknown>): ToolDef {
  return {
    name,
    description,
    strict: true,
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    } as ToolDef["input_schema"],
  };
}

const TOOL_DEFS: ToolDef[] = [
  tool("create_task", "Create a task or reminder in the user's JARVIS task list.", {
    title: { type: "string", description: "Short task title" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    due_at: nullableString("Due date-time in ISO 8601 with UTC offset, or null"),
    notes: nullableString("Extra details, or null"),
  }),
  tool("list_tasks", "List the user's tasks, ordered by priority and due date.", {
    include_done: { type: "boolean", description: "Include completed tasks" },
  }),
  tool("complete_task", "Mark a task as done.", {
    task_id: { type: "integer" },
  }),
  tool("create_event", "Add an event to the user's JARVIS calendar.", {
    title: { type: "string" },
    start_at: { type: "string", description: "Start in ISO 8601 with UTC offset" },
    end_at: nullableString("End in ISO 8601 with UTC offset, or null"),
    location: nullableString("Location, or null"),
    notes: nullableString("Notes, or null"),
  }),
  tool("list_events", "List calendar events between two date-times.", {
    from: { type: "string", description: "Range start, ISO 8601" },
    to: { type: "string", description: "Range end, ISO 8601" },
  }),
  tool("create_note", "Save a note for the user.", {
    title: { type: "string" },
    body: { type: "string", description: "Note body in Markdown" },
  }),
  tool("search_notes", "Search the user's notes by keyword. Use an empty query to list recent notes.", {
    query: { type: "string" },
  }),
];

const MEMORY_TOOL: ToolDef = tool(
  "propose_memory",
  "Propose a durable preference or fact about the user to remember. The user must approve it before it is saved.",
  {
    content: { type: "string", description: "One concise sentence, e.g. 'Prefers metric units.'" },
    category: { type: "string", enum: ["preference", "fact", "instruction", "tool"] },
  },
);

export function toolDefinitions(opts: { memory: boolean }): ToolDef[] {
  return opts.memory ? [...TOOL_DEFS, MEMORY_TOOL] : TOOL_DEFS;
}

const schemas = {
  create_task: z.object({
    title: z.string().min(1).max(300),
    priority: z.enum(["low", "medium", "high"]),
    due_at: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  list_tasks: z.object({ include_done: z.boolean() }),
  complete_task: z.object({ task_id: z.number().int() }),
  create_event: z.object({
    title: z.string().min(1).max(300),
    start_at: z.string(),
    end_at: z.string().nullable(),
    location: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  list_events: z.object({ from: z.string(), to: z.string() }),
  create_note: z.object({ title: z.string().min(1).max(300), body: z.string() }),
  search_notes: z.object({ query: z.string() }),
  propose_memory: z.object({
    content: z.string().min(1).max(500),
    category: z.enum(["preference", "fact", "instruction", "tool"]),
  }),
};

export type ToolName = keyof typeof schemas;

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** What changed, so the client can refresh the matching view. */
  changed?: "tasks" | "events" | "notes";
  /** A short human-readable summary shown in the chat. */
  summary?: string;
  memoryProposal?: { content: string; category: string };
}

export function executeTool(db: DB, userId: number, tz: string, name: string, rawInput: unknown): ToolOutcome {
  const schema = schemas[name as ToolName];
  if (!schema) return { content: `Unknown tool: ${name}`, isError: true };
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    return { content: `INVALID_INPUT: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, isError: true };
  }
  const input = parsed.data as any;
  const fmt = (ms: number | null) => (ms == null ? null : isoInZone(ms, tz));

  switch (name as ToolName) {
    case "create_task": {
      const due = input.due_at ? parseUserDate(input.due_at, tz) : null;
      if (input.due_at && due == null) return { content: "INVALID_INPUT: due_at is not a valid date", isError: true };
      const t = store.createTask(db, userId, { title: input.title, priority: input.priority, due_at: due, notes: input.notes ?? "" });
      return {
        content: JSON.stringify({ created: { id: t.id, title: t.title, priority: t.priority, due_at: fmt(t.due_at) } }),
        changed: "tasks",
        summary: `Task added: ${t.title}`,
      };
    }
    case "list_tasks": {
      const tasks = store.listTasks(db, userId, { includeDone: input.include_done }).slice(0, 100);
      return {
        content: JSON.stringify(
          tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, due_at: fmt(t.due_at), done: t.done, notes: t.notes || undefined })),
        ),
        summary: `Checked ${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
      };
    }
    case "complete_task": {
      const t = store.updateTask(db, userId, input.task_id, { done: true });
      if (!t) return { content: "No task with that id.", isError: true };
      return { content: JSON.stringify({ completed: t.title }), changed: "tasks", summary: `Completed: ${t.title}` };
    }
    case "create_event": {
      const start = parseUserDate(input.start_at, tz);
      const end = input.end_at ? parseUserDate(input.end_at, tz) : null;
      if (start == null) return { content: "INVALID_INPUT: start_at is not a valid date", isError: true };
      const e = store.createEvent(db, userId, {
        title: input.title,
        start_at: start,
        end_at: end,
        location: input.location ?? "",
        notes: input.notes ?? "",
      });
      return {
        content: JSON.stringify({ created: { id: e.id, title: e.title, start_at: fmt(e.start_at), end_at: fmt(e.end_at) } }),
        changed: "events",
        summary: `Event added: ${e.title}`,
      };
    }
    case "list_events": {
      const from = parseUserDate(input.from, tz) ?? Date.now();
      const to = parseUserDate(input.to, tz) ?? from + 7 * 864e5;
      const events = store.listEvents(db, userId, from, to).slice(0, 100);
      return {
        content: JSON.stringify(
          events.map((e) => ({ id: e.id, title: e.title, start_at: fmt(e.start_at), end_at: fmt(e.end_at), location: e.location || undefined })),
        ),
        summary: `Checked calendar (${events.length} event${events.length === 1 ? "" : "s"})`,
      };
    }
    case "create_note": {
      const n = store.createNote(db, userId, { title: input.title, body: input.body });
      return { content: JSON.stringify({ created: { id: n.id, title: n.title } }), changed: "notes", summary: `Note saved: ${n.title}` };
    }
    case "search_notes": {
      const notes = store.listNotes(db, userId, input.query).slice(0, 20);
      return {
        content: JSON.stringify(notes.map((n) => ({ id: n.id, title: n.title, body: n.body.slice(0, 2000) }))),
        summary: `Searched notes (${notes.length} found)`,
      };
    }
    case "propose_memory":
      return {
        content: "Proposed to the user for approval. It will only be saved if they approve it in the app.",
        memoryProposal: { content: input.content, category: input.category },
        summary: "Memory proposed",
      };
  }
}
