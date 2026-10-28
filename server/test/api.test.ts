import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { openDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { demoProvider } from "../src/ai/demo.js";
import { anthropicProvider } from "../src/ai/provider.js";
import { runChat } from "../src/ai/chat.js";
import { getSettings } from "../src/settings.js";
import { buildCalendar } from "../../shared/ics.js";
import { parseUserDate } from "../../shared/time.js";

function setup() {
  const db = openDb(":memory:");
  const app = createApp(db, demoProvider());
  return { db, app };
}

async function register(app: any, email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ email, password: "password123", name: "Test", timezone: "Asia/Qatar" });
  return { agent, res };
}

function parseSse(text: string) {
  return text
    .split("\n\n")
    .filter((c) => c.startsWith("data: "))
    .map((c) => JSON.parse(c.slice(6)));
}

describe("auth", () => {
  it("registers the first account, then closes sign-ups by default", async () => {
    const { app } = setup();
    const { res } = await register(app, "a@example.com");
    expect(res.status).toBe(201);
    const second = await register(app, "b@example.com");
    expect(second.res.status).toBe(403);
  });

  it("rejects wrong passwords and unauthenticated API calls", async () => {
    const { app } = setup();
    await register(app, "a@example.com");
    expect((await request(app).post("/api/auth/login").send({ email: "a@example.com", password: "nope" })).status).toBe(401);
    expect((await request(app).get("/api/tasks")).status).toBe(401);
    const ok = request.agent(app);
    expect((await ok.post("/api/auth/login").send({ email: "a@example.com", password: "password123" })).status).toBe(200);
    expect((await ok.get("/api/tasks")).status).toBe(200);
  });

  it("supports bearer tokens for Shortcuts", async () => {
    const { app } = setup();
    const { agent } = await register(app, "a@example.com");
    const { body } = await agent.post("/api/tokens").send({ label: "Shortcuts" });
    const res = await request(app).get("/api/shortcuts/agenda").set("Authorization", `Bearer ${body.token}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("No events");
  });

  it("blocks cross-origin cookie requests", async () => {
    const { app } = setup();
    const { agent } = await register(app, "a@example.com");
    const res = await agent.post("/api/tasks").set("Origin", "https://evil.example").send({ title: "x" });
    expect(res.status).toBe(403);
  });
});

describe("data isolation", () => {
  it("never exposes one user's data to another", async () => {
    const { app } = setup();
    const { config } = await import("../src/config.js");
    config.allowSignup = "1";
    const a = (await register(app, "a@example.com")).agent;
    const b = (await register(app, "b@example.com")).agent;
    const task = (await a.post("/api/tasks").send({ title: "secret" })).body.task;
    const note = (await a.post("/api/notes").send({ title: "secret note" })).body.note;
    expect((await b.get("/api/tasks")).body.tasks).toHaveLength(0);
    expect((await b.patch(`/api/tasks/${task.id}`).send({ done: true })).status).toBe(404);
    expect((await b.delete(`/api/notes/${note.id}`)).status).toBe(404);
    expect((await b.get(`/api/notes?q=secret`)).body.notes).toHaveLength(0);
    config.allowSignup = undefined;
  });
});

describe("productivity APIs", () => {
  let agent: any;
  beforeEach(async () => {
    const { app } = setup();
    agent = (await register(app, "a@example.com")).agent;
  });

  it("CRUDs tasks ordered by priority", async () => {
    await agent.post("/api/tasks").send({ title: "low", priority: "low" });
    await agent.post("/api/tasks").send({ title: "high", priority: "high" });
    const { tasks } = (await agent.get("/api/tasks")).body;
    expect(tasks.map((t: any) => t.title)).toEqual(["high", "low"]);
    await agent.patch(`/api/tasks/${tasks[0].id}`).send({ done: true });
    expect((await agent.get("/api/tasks")).body.tasks).toHaveLength(1);
    expect((await agent.get("/api/tasks?all=1")).body.tasks).toHaveLength(2);
  });

  it("searches notes and exports markdown", async () => {
    await agent.post("/api/notes").send({ title: "Groceries", body: "milk, eggs" });
    await agent.post("/api/notes").send({ title: "Work", body: "quarterly 100% report" });
    expect((await agent.get("/api/notes?q=eggs")).body.notes).toHaveLength(1);
    expect((await agent.get("/api/notes?q=100%25")).body.notes).toHaveLength(1);
    const md = await agent.get("/api/export/notes.md");
    expect(md.text).toContain("# Groceries");
  });

  it("serves a token-protected calendar feed", async () => {
    await agent.post("/api/events").send({ title: "Board meeting", start_at: Date.UTC(2026, 10, 2, 9) });
    const { path } = (await agent.get("/api/calendar/feed")).body;
    const ics = await request(agent.app).get(path);
    expect(ics.status).toBe(200);
    expect(ics.text).toContain("SUMMARY:Board meeting");
    expect(ics.text).toContain("DTSTART:20261102T090000Z");
    expect((await request(agent.app).get("/feeds/calendar/wrong.ics")).status).toBe(404);
  });

  it("manages memories", async () => {
    const { memory } = (await agent.post("/api/memories").send({ content: "Prefers metric units" })).body;
    await agent.patch(`/api/memories/${memory.id}`).send({ content: "Prefers metric units and 24h time" });
    expect((await agent.get("/api/memories")).body.memories[0].content).toContain("24h");
  });
});

describe("chat", () => {
  it("streams a reply, runs tools and persists the conversation", async () => {
    const { app } = setup();
    const { agent } = await register(app, "a@example.com");
    const res = await agent.post("/api/chat").send({ text: "Add task renew passport" }).buffer(true).parse((r: any, cb: any) => {
      let data = "";
      r.on("data", (c: Buffer) => (data += c));
      r.on("end", () => cb(null, data));
    });
    const events = parseSse(res.body);
    expect(events[0].type).toBe("meta");
    expect(events.some((e) => e.type === "action" && e.changed === "tasks")).toBe(true);
    expect(events.at(-1).type).toBe("done");
    expect((await agent.get("/api/tasks")).body.tasks[0].title).toBe("renew passport");
    const conv = (await agent.get(`/api/conversations/${events[0].conversationId}`)).body;
    expect(conv.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(conv.messages[0].meta.context).toBeUndefined(); // internal context isn't exposed
  });
});

describe("Claude API request", () => {
  it("sends a well-formed streaming request with fallbacks, tools and caching", async () => {
    let captured: { headers: Headers; body: any } | null = null;
    const sse = [
      { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Certainly." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ]
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join("");
    const fakeFetch = (async (_url: any, init: any) => {
      captured = { headers: new Headers(init.headers), body: JSON.parse(init.body) };
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    const db = openDb(":memory:");
    db.prepare("INSERT INTO users (email, name, password_hash, feed_token, created_at) VALUES ('a@x.com','A','x','t',0)").run();
    const provider = anthropicProvider("sk-test", { fetch: fakeFetch, maxRetries: 0 });
    let text = "";
    await runChat({
      db,
      provider,
      user: { id: 1, email: "a@x.com", name: "A" },
      settings: { ...getSettings(db, 1), timezone: "Asia/Qatar" },
      conversationId: null,
      text: "Hello",
      attachments: [],
      webSearch: true,
      send: (e) => e.type === "text" && (text += e.delta),
      signal: new AbortController().signal,
    });

    expect(text).toBe("Certainly.");
    const body = captured!.body;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.stream).toBe(true);
    expect(body.output_config).toEqual({ effort: "medium" });
    expect(body.fallbacks).toBe("default");
    expect(captured!.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[0].text).toContain("You are JARVIS");
    expect(body.tools.map((t: any) => t.name)).toEqual(
      expect.arrayContaining(["create_task", "list_events", "propose_memory", "web_search"]),
    );
    expect(body.tools.find((t: any) => t.name === "create_task").strict).toBe(true);
    const last = body.messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content[0].text).toMatch(/^<context>Current local time: .*Asia\/Qatar/);
    expect(last.content.at(-1).text).toBe("Hello");
  });
});

describe("helpers", () => {
  it("parses local times in the user's timezone", () => {
    expect(parseUserDate("2026-11-02T09:00:00", "Asia/Qatar")).toBe(Date.UTC(2026, 10, 2, 6));
    expect(parseUserDate("2026-11-02T09:00:00Z", "Asia/Qatar")).toBe(Date.UTC(2026, 10, 2, 9));
    expect(parseUserDate("not a date", "UTC")).toBeNull();
  });

  it("escapes ICS text", () => {
    const ics = buildCalendar("x", "host", [
      { id: 1, title: "A, B; C", start_at: 0, end_at: null, all_day: false, location: "", notes: "line1\nline2", created_at: 0 },
    ]);
    expect(ics).toContain("SUMMARY:A\\, B\; C");
    expect(ics).toContain("DESCRIPTION:line1\\nline2");
  });
});
