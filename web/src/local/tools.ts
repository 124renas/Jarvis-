// JARVIS tools for the on-device edition, declared in Gemini's function-calling
// format and executed against on-device storage.
import { isoInZone, parseUserDate } from "../../../shared/time";
import * as data from "./data";
import { generate, type FunctionDeclaration } from "./gemini";

const S = (description: string) => ({ type: "STRING", description });
const NS = (description: string) => ({ type: "STRING", nullable: true, description });

function fn(name: string, description: string, properties: Record<string, unknown>, required = Object.keys(properties)): FunctionDeclaration {
  return { name, description, parameters: { type: "OBJECT", properties, required } };
}

const DECLARATIONS: FunctionDeclaration[] = [
  fn("create_task", "Create a task or reminder in the user's JARVIS task list.", {
    title: S("Short task title"),
    priority: { type: "STRING", enum: ["low", "medium", "high"] },
    due_at: NS("Due date-time in ISO 8601 with UTC offset, or null"),
    notes: NS("Extra details, or null"),
  }, ["title", "priority"]),
  fn("list_tasks", "List the user's tasks, ordered by priority and due date.", {
    include_done: { type: "BOOLEAN", description: "Include completed tasks" },
  }, []),
  fn("complete_task", "Mark a task as done.", { task_id: { type: "INTEGER" } }),
  fn("create_event", "Add an event to the user's JARVIS calendar.", {
    title: S("Event title"),
    start_at: S("Start in ISO 8601 with UTC offset"),
    end_at: NS("End in ISO 8601 with UTC offset, or null"),
    location: NS("Location, or null"),
    notes: NS("Notes, or null"),
  }, ["title", "start_at"]),
  fn("list_events", "List calendar events between two date-times.", {
    from: S("Range start, ISO 8601"),
    to: S("Range end, ISO 8601"),
  }),
  fn("create_note", "Save a note for the user.", { title: S("Note title"), body: S("Note body in Markdown") }),
  fn("search_notes", "Search the user's notes by keyword. Use an empty query to list recent notes.", { query: S("Keywords") }),
];

const WEB_SEARCH = fn("web_search", "Search the web (Google) for current information. Returns a summary and source links.", {
  query: S("What to search for"),
});

const MEMORY = fn(
  "propose_memory",
  "Propose a durable preference or fact about the user to remember. The user must approve it before it is saved.",
  {
    content: S("One concise sentence, e.g. 'Prefers metric units.'"),
    category: { type: "STRING", enum: ["preference", "fact", "instruction", "tool"] },
  },
);

export function declarations(opts: { memory: boolean; web: boolean }): FunctionDeclaration[] {
  return [...DECLARATIONS, ...(opts.web ? [WEB_SEARCH] : []), ...(opts.memory ? [MEMORY] : [])];
}

export interface ToolOutcome {
  response: Record<string, unknown>;
  isError?: boolean;
  changed?: "tasks" | "events" | "notes";
  summary?: string;
  memoryProposal?: { content: string; category: string };
  sources?: { title: string; url: string }[];
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? null : String(v));
const err = (message: string): ToolOutcome => ({ response: { error: message }, isError: true });

export async function executeTool(
  name: string,
  args: Record<string, any>,
  ctx: { tz: string; key: string; model: string; signal?: AbortSignal },
): Promise<ToolOutcome> {
  const { tz } = ctx;
  const fmt = (ms: number | null) => (ms == null ? null : isoInZone(ms, tz));
  switch (name) {
    case "create_task": {
      const title = str(args.title)?.trim();
      if (!title) return err("title is required");
      const due = args.due_at ? parseUserDate(str(args.due_at), tz) : null;
      if (args.due_at && due == null) return err("due_at is not a valid date");
      const priority = ["low", "medium", "high"].includes(args.priority) ? args.priority : "medium";
      const t = await data.createTask({ title, priority, due_at: due, notes: str(args.notes) ?? "" });
      return { response: { created: { id: t.id, title: t.title, priority: t.priority, due_at: fmt(t.due_at) } }, changed: "tasks", summary: `Task added: ${t.title}` };
    }
    case "list_tasks": {
      const tasks = (await data.listTasks(!!args.include_done)).slice(0, 100);
      return {
        response: { tasks: tasks.map((t) => ({ id: t.id, title: t.title, priority: t.priority, due_at: fmt(t.due_at), done: t.done, notes: t.notes || undefined })) },
        summary: `Checked ${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
      };
    }
    case "complete_task": {
      const t = await data.updateTask(Number(args.task_id), { done: true });
      if (!t) return err("No task with that id.");
      return { response: { completed: t.title }, changed: "tasks", summary: `Completed: ${t.title}` };
    }
    case "create_event": {
      const title = str(args.title)?.trim();
      const start = parseUserDate(str(args.start_at), tz);
      if (!title || start == null) return err("title and a valid start_at are required");
      const e = await data.createEvent({
        title,
        start_at: start,
        end_at: args.end_at ? parseUserDate(str(args.end_at), tz) : null,
        location: str(args.location) ?? "",
        notes: str(args.notes) ?? "",
      });
      return { response: { created: { id: e.id, title: e.title, start_at: fmt(e.start_at), end_at: fmt(e.end_at) } }, changed: "events", summary: `Event added: ${e.title}` };
    }
    case "list_events": {
      const from = parseUserDate(str(args.from), tz) ?? Date.now();
      const to = parseUserDate(str(args.to), tz) ?? from + 7 * 864e5;
      const events = (await data.listEvents(from, to)).slice(0, 100);
      return {
        response: { events: events.map((e) => ({ id: e.id, title: e.title, start_at: fmt(e.start_at), end_at: fmt(e.end_at), location: e.location || undefined })) },
        summary: `Checked calendar (${events.length} event${events.length === 1 ? "" : "s"})`,
      };
    }
    case "create_note": {
      const title = str(args.title)?.trim();
      if (!title) return err("title is required");
      const n = await data.createNote({ title, body: str(args.body) ?? "" });
      return { response: { created: { id: n.id, title: n.title } }, changed: "notes", summary: `Note saved: ${n.title}` };
    }
    case "search_notes": {
      const notes = (await data.listNotes(str(args.query) ?? "")).slice(0, 20);
      return { response: { notes: notes.map((n) => ({ id: n.id, title: n.title, body: n.body.slice(0, 2000) })) }, summary: `Searched notes (${notes.length} found)` };
    }
    case "web_search": {
      const query = str(args.query)?.trim();
      if (!query) return err("query is required");
      const r = await generate({
        key: ctx.key,
        model: ctx.model,
        googleSearch: true,
        contents: [{ role: "user", parts: [{ text: `Search the web and give a factual, well-sourced summary (with dates) for: ${query}` }] }],
        signal: ctx.signal,
      });
      return { response: { summary: r.text, sources: r.sources.map((s) => s.title) }, sources: r.sources, summary: `Searched the web: ${query}` };
    }
    case "propose_memory": {
      const content = str(args.content)?.trim();
      if (!content) return err("content is required");
      const category = ["preference", "fact", "instruction", "tool"].includes(args.category) ? args.category : "preference";
      return {
        response: { result: "Proposed to the user for approval. It will only be saved if they approve it in the app." },
        memoryProposal: { content, category },
        summary: "Memory proposed",
      };
    }
    default:
      return err(`Unknown tool: ${name}`);
  }
}
