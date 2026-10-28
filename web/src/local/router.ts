// Answers the app's /api/* calls on-device, mirroring the server's routes and
// JSON shapes so the same UI works in both editions.
import { buildCalendar } from "../../../shared/ics";
import { PARSE_SYSTEM, SUMMARY_SYSTEM } from "../../../shared/prompt";
import { formatUserTime, parseUserDate, safeTimeZone, tzOffset } from "../../../shared/time";
import { ApiError } from "../lib/api";
import type { ParsedItem, Settings } from "../lib/types";
import * as data from "./data";
import { eraseEverything, kv, requestPersistence } from "./idb";
import { generate, GeminiError, listModels, type GeminiModel } from "./gemini";
import { getKey, getProfile, getSettings, saveSettings, setKey, setProfile } from "./settings";

export interface LocalFile {
  __file: { name: string; type: string; text: string };
}

const USER_ID = 1;
const notFound = (what = "Item"): never => {
  throw new ApiError(404, `${what} not found.`);
};
const unavailable = (): never => {
  throw new ApiError(404, "This feature needs the server edition of JARVIS.");
};
const file = (name: string, type: string, text: string): LocalFile => ({ __file: { name, type, text } });

let modelCache: { key: string; models: GeminiModel[] } | null = null;

async function models(key: string, current: string): Promise<GeminiModel[]> {
  if (key && modelCache?.key !== key) {
    try {
      modelCache = { key, models: await listModels(key) };
    } catch {
      modelCache = null;
    }
  }
  const list = modelCache?.models ?? [];
  const all = list.some((m) => m.id === current) ? list : [{ id: current, label: current, note: "" }, ...list];
  return [{ id: "gemini-flash-latest", label: "Gemini Flash (latest)", note: "Recommended" }, ...all.filter((m) => m.id !== "gemini-flash-latest")];
}

async function validateKey(key: string) {
  try {
    await listModels(key);
  } catch (err) {
    if (err instanceof GeminiError && err.status === 0) return; // offline: accept and verify later
    throw new ApiError(400, (err as Error).message);
  }
}

async function aiError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GeminiError) throw new ApiError(err.status || 503, err.message);
    throw err;
  }
}

async function requireKey() {
  const key = await getKey();
  if (!key) throw new ApiError(400, "Add your free Gemini API key in Settings › Intelligence first.");
  return key;
}

const PARSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["task", "event"] },
    title: { type: "STRING" },
    priority: { type: "STRING", enum: ["low", "medium", "high"] },
    due_or_start: { type: "STRING", nullable: true },
    end: { type: "STRING", nullable: true },
    location: { type: "STRING", nullable: true },
    notes: { type: "STRING", nullable: true },
  },
  required: ["kind", "title", "priority"],
};

export async function handleLocal(method: string, rawPath: string, body: any): Promise<unknown> {
  const url = new URL(rawPath, "http://local");
  const path = url.pathname;
  const q = url.searchParams;
  const seg = path.split("/").filter(Boolean);
  const id = Number(seg[1]);
  const settings = await getSettings();

  // ---- Profile / "auth" (device-only, no accounts) ----
  if (path === "/auth/session") {
    const profile = await getProfile();
    return { user: profile ? { id: USER_ID, email: "", name: profile.name } : null, signupAllowed: true };
  }
  if (path === "/auth/register") {
    const name = String(body?.name ?? "").trim();
    const key = String(body?.key ?? "").trim();
    if (!name) throw new ApiError(400, "Please tell JARVIS your name.");
    if (!key) throw new ApiError(400, "Paste your Gemini API key.");
    await validateKey(key);
    await setKey(key);
    await setProfile({ name, created_at: Date.now() });
    await saveSettings({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    requestPersistence();
    return { user: { id: USER_ID, email: "", name } };
  }
  if (path === "/auth/logout") return { ok: true };
  if (path === "/auth/profile") {
    const profile = await getProfile();
    const name = String(body?.name ?? "").trim() || profile?.name || "";
    await setProfile({ name, created_at: profile?.created_at ?? Date.now() });
    return { user: { id: USER_ID, email: "", name } };
  }

  // ---- Settings / status / key ----
  if (path === "/settings") return { settings: method === "PATCH" ? await saveSettings(body as Partial<Settings>) : settings };
  if (path === "/status") {
    const key = await getKey();
    return { ai: "gemini", models: await models(key, settings.model), pushDevices: 0, vapidPublicKey: "" };
  }
  if (path === "/local/key") {
    if (method === "GET") {
      const key = await getKey();
      return { hasKey: !!key, masked: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : "" };
    }
    const key = String(body?.key ?? "").trim();
    if (!key) throw new ApiError(400, "Paste your Gemini API key.");
    await validateKey(key);
    await setKey(key);
    modelCache = null;
    return { ok: true };
  }

  // ---- Conversations ----
  if (seg[0] === "conversations") {
    if (!seg[1]) {
      if (method === "GET") {
        const convs = (await data.conversations.all()).sort((a, b) => b.updated_at - a.updated_at);
        const msgs = await data.messages.all();
        const last = new Map<number, string>();
        for (const m of msgs.sort((a, b) => a.id - b.id)) last.set(m.conversation_id, m.content.slice(0, 140));
        return { conversations: convs.map((c) => ({ ...c, preview: last.get(c.id) ?? null })) };
      }
      if (method === "POST") {
        const conv = await data.conversations.put({ title: String(body?.title ?? "New conversation"), created_at: Date.now(), updated_at: Date.now() });
        return { conversation: { id: conv.id, title: conv.title } };
      }
      if (method === "DELETE") {
        const all = await data.conversations.all();
        await data.conversations.clear();
        await data.messages.clear();
        return { deleted: all.length };
      }
    }
    const conv = await data.conversations.get(id);
    if (!conv) notFound("Conversation");
    if (method === "GET") {
      const messages = (await data.conversationMessages(id)).map(({ meta, ...m }) => {
        const { context: _context, ...rest } = meta ?? {};
        return { ...m, meta: rest };
      });
      return { conversation: conv, messages };
    }
    if (method === "PATCH") {
      await data.conversations.put({ ...conv!, title: String(body?.title ?? conv!.title).slice(0, 120) });
      return { ok: true };
    }
    if (method === "DELETE") {
      await data.deleteConversation(id);
      return { ok: true };
    }
  }

  // ---- Tasks ----
  if (seg[0] === "tasks") {
    if (seg[2] === "ics") {
      const t = await data.tasksTable.get(id);
      if (!t || t.due_at == null) notFound("Task with a due date");
      return file(`task-${id}.ics`, "text/calendar", buildCalendar(t!.title, location.host, [], [t!]));
    }
    if (!seg[1]) {
      if (method === "GET") return { tasks: await data.listTasks(q.get("all") === "1") };
      if (!String(body?.title ?? "").trim()) throw new ApiError(400, "title: required");
      return { task: await data.createTask(body) };
    }
    if (method === "PATCH") {
      const task = await data.updateTask(id, body);
      if (!task) notFound("Task");
      return { task };
    }
    if (method === "DELETE") {
      if (!(await data.tasksTable.get(id))) notFound("Task");
      await data.tasksTable.delete(id);
      return { ok: true };
    }
  }

  // ---- Events ----
  if (seg[0] === "events") {
    if (seg[2] === "ics") {
      const e = await data.eventsTable.get(id);
      if (!e) notFound("Event");
      return file(`event-${id}.ics`, "text/calendar", buildCalendar(e!.title, location.host, [e!]));
    }
    if (!seg[1]) {
      if (method === "GET") return { events: await data.listEvents(Number(q.get("from") ?? 0), q.get("to") ? Number(q.get("to")) : undefined) };
      if (!String(body?.title ?? "").trim() || typeof body?.start_at !== "number") throw new ApiError(400, "title and start time are required");
      return { event: await data.createEvent(body) };
    }
    const current = await data.eventsTable.get(id);
    if (!current) notFound("Event");
    if (method === "PATCH") return { event: await data.eventsTable.put({ ...current!, ...body, id }) };
    if (method === "DELETE") {
      await data.eventsTable.delete(id);
      return { ok: true };
    }
  }

  // ---- Notes ----
  if (seg[0] === "notes") {
    if (!seg[1]) {
      if (method === "GET") return { notes: await data.listNotes(q.get("q") ?? "") };
      if (!String(body?.title ?? "").trim()) throw new ApiError(400, "title: required");
      return { note: await data.createNote(body) };
    }
    const note = await data.notesTable.get(id);
    if (!note) notFound("Note");
    if (method === "GET") return { note };
    if (method === "PATCH") return { note: await data.notesTable.put({ ...note!, ...body, id, updated_at: Date.now() }) };
    if (method === "DELETE") {
      await data.notesTable.delete(id);
      return { ok: true };
    }
  }

  // ---- Memories ----
  if (seg[0] === "memories") {
    if (!seg[1]) {
      if (method === "GET") return { memories: await data.listMemories() };
      if (method === "DELETE") {
        await data.memoriesTable.clear();
        return { ok: true };
      }
      const content = String(body?.content ?? "").trim();
      if (!content) throw new ApiError(400, "content: required");
      return { memory: await data.memoriesTable.put({ content, category: body?.category ?? "preference", created_at: Date.now() }) };
    }
    const mem = await data.memoriesTable.get(id);
    if (!mem) notFound("Memory");
    if (method === "PATCH") return { memory: await data.memoriesTable.put({ ...mem!, ...body, id }) };
    if (method === "DELETE") {
      await data.memoriesTable.delete(id);
      return { ok: true };
    }
  }

  // ---- AI utilities ----
  if (path === "/assist/summarize") {
    const key = await requireKey();
    const text = String(body?.text ?? "").trim();
    if (!text) throw new ApiError(400, "Nothing to summarise.");
    const r = await aiError(() =>
      generate({ key, model: settings.model, system: SUMMARY_SYSTEM, contents: [{ role: "user", parts: [{ text: `<text>\n${text}\n</text>` }] }] }),
    );
    return { text: r.text };
  }
  if (path === "/assist/parse") {
    const key = await requireKey();
    const tz = safeTimeZone(settings.timezone);
    const hint = body?.kind as "task" | "event" | undefined;
    const r = await aiError(() =>
      generate({
        key,
        model: settings.model,
        system: PARSE_SYSTEM,
        jsonSchema: PARSE_SCHEMA,
        contents: [
          {
            role: "user",
            parts: [{ text: `Current local time: ${formatUserTime(Date.now(), tz)} (${tz}, UTC${tzOffset(tz)}).${hint ? ` The user wants a ${hint}.` : ""}\n\nRequest: ${body?.text ?? ""}` }],
          },
        ],
      }),
    );
    let p: any;
    try {
      p = JSON.parse(r.text);
    } catch {
      throw new ApiError(502, "JARVIS couldn't understand that. Try rephrasing.");
    }
    const item: ParsedItem = {
      kind: hint ?? (p.kind === "event" ? "event" : "task"),
      title: String(p.title || body?.text || "").trim(),
      priority: ["low", "medium", "high"].includes(p.priority) ? p.priority : "medium",
      at: parseUserDate(p.due_or_start, tz),
      end: parseUserDate(p.end, tz),
      location: p.location ?? "",
      notes: p.notes ?? "",
    };
    return { item };
  }

  // ---- Export / import / erase ----
  if (path === "/export/notes.md") {
    const notes = await data.listNotes();
    return file(
      "jarvis-notes.md",
      "text/markdown",
      notes.map((n) => `# ${n.title}\n\n_Updated ${new Date(n.updated_at).toISOString()}_\n\n${n.body}\n`).join("\n---\n\n"),
    );
  }
  if (path === "/export/all.json") {
    const dump = {
      format: "jarvis-ondevice-v1",
      exported_at: new Date().toISOString(),
      profile: await getProfile(),
      settings,
      memories: await data.memoriesTable.all(),
      tasks: await data.tasksTable.all(),
      events: await data.eventsTable.all(),
      notes: await data.notesTable.all(),
      conversations: await data.conversations.all(),
      messages: await data.messages.all(),
    };
    return file("jarvis-export.json", "application/json", JSON.stringify(dump, null, 2));
  }
  if (path === "/local/import") {
    const dump = body as any;
    if (dump?.format !== "jarvis-ondevice-v1") throw new ApiError(400, "That file isn't a JARVIS on-device export.");
    const key = await getKey();
    await eraseEverything();
    if (key) await setKey(key);
    if (dump.profile) await setProfile(dump.profile);
    if (dump.settings) await kv.set("settings", { ...dump.settings, timezone: settings.timezone });
    for (const [t, rows] of [
      [data.memoriesTable, dump.memories],
      [data.tasksTable, dump.tasks],
      [data.eventsTable, dump.events],
      [data.notesTable, dump.notes],
      [data.conversations, dump.conversations],
      [data.messages, dump.messages],
    ] as const) {
      for (const row of (rows as any[]) ?? []) await (t as any).put(row);
    }
    return { ok: true };
  }
  if (path === "/account" && method === "DELETE") {
    await eraseEverything();
    return { ok: true };
  }

  return unavailable();
}
