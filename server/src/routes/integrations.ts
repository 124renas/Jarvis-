import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db.js";
import { createSession, randomToken } from "../auth.js";
import { MODELS } from "../config.js";
import { runChat } from "../ai/chat.js";
import { describeAiError, type AiProvider } from "../ai/provider.js";
import { buildCalendar } from "../../../shared/ics.js";
import * as store from "../lib/store.js";
import { formatUserTime, safeTimeZone } from "../../../shared/time.js";
import { HttpError, idParam, notFound, parseBody, rateLimit } from "../lib/http.js";
import { getVapidPublicKey, sendToUser } from "../push.js";
import { getSettings, updateSettings } from "../settings.js";
import { parseNatural } from "./assist.js";

const hostOf = (req: any) => String(req.headers.host ?? "jarvis.local").replace(/:\d+$/, "");

/** Public, token-protected calendar feed for Apple Calendar subscriptions. */
export function feedRoutes(db: DB) {
  const r = Router();
  r.get("/calendar/:token.ics", (req, res) => {
    const user = db.prepare("SELECT id, name FROM users WHERE feed_token = ?").get(req.params.token) as
      | { id: number; name: string }
      | undefined;
    if (!user) {
      res.status(404).send("Not found");
      return;
    }
    const from = Date.now() - 90 * 864e5;
    const ics = buildCalendar(
      "JARVIS",
      hostOf(req),
      store.listEvents(db, user.id, from),
      store.listTasks(db, user.id).filter((t) => t.due_at && t.due_at > from),
    );
    res.type("text/calendar; charset=utf-8").setHeader("Cache-Control", "no-cache").send(ics);
  });
  return r;
}

export function integrationRoutes(db: DB, provider: AiProvider) {
  const r = Router();
  const uid = (req: any) => req.user.id as number;

  // ---- Settings & status ----
  r.get("/settings", (req, res) => res.json({ settings: getSettings(db, uid(req)) }));
  r.patch("/settings", (req, res) => {
    try {
      res.json({ settings: updateSettings(db, uid(req), req.body) });
    } catch (e) {
      throw new HttpError(400, e instanceof z.ZodError ? e.issues[0].message : "Invalid settings.");
    }
  });
  r.get("/status", (req, res) => {
    const pushCount = (db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?").get(uid(req)) as { n: number }).n;
    res.json({ ai: provider.name, models: MODELS, pushDevices: pushCount, vapidPublicKey: getVapidPublicKey() });
  });

  // ---- Push notifications ----
  const Subscription = z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
  });
  r.post("/push/subscribe", (req, res) => {
    const sub = parseBody(Subscription, req.body);
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, json, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, json = excluded.json`,
    ).run(uid(req), sub.endpoint, JSON.stringify(sub), Date.now());
    res.json({ ok: true });
  });
  r.post("/push/unsubscribe", (req, res) => {
    const { endpoint } = parseBody(z.object({ endpoint: z.string().max(2000) }), req.body);
    db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, uid(req));
    res.json({ ok: true });
  });
  r.post("/push/test", rateLimit({ windowMs: 60_000, max: 5, key: (req) => `pushtest:${req.user!.id}` }), async (req, res) => {
    const delivered = await sendToUser(db, uid(req), { title: "JARVIS", body: "Notifications are online.", url: "/" });
    res.json({ delivered });
  });

  // ---- Calendar export ----
  r.get("/calendar/feed", (req, res) => {
    const row = db.prepare("SELECT feed_token FROM users WHERE id = ?").get(uid(req)) as { feed_token: string };
    res.json({ path: `/feeds/calendar/${row.feed_token}.ics` });
  });
  r.post("/calendar/feed/rotate", (req, res) => {
    const token = randomToken(24);
    db.prepare("UPDATE users SET feed_token = ? WHERE id = ?").run(token, uid(req));
    res.json({ path: `/feeds/calendar/${token}.ics` });
  });
  r.get("/events/:id/ics", (req, res) => {
    const event = store.getEvent(db, uid(req), idParam(req));
    if (!event) notFound("Event");
    res
      .type("text/calendar; charset=utf-8")
      .setHeader("Content-Disposition", `attachment; filename="event-${event.id}.ics"`)
      .send(buildCalendar(event.title, hostOf(req), [event]));
  });
  r.get("/tasks/:id/ics", (req, res) => {
    const task = store.getTask(db, uid(req), idParam(req));
    if (!task || task.due_at == null) notFound("Task with a due date");
    res
      .type("text/calendar; charset=utf-8")
      .setHeader("Content-Disposition", `attachment; filename="task-${task.id}.ics"`)
      .send(buildCalendar(task.title, hostOf(req), [], [task]));
  });

  // ---- Personal access tokens (for iOS Shortcuts / Siri) ----
  r.get("/tokens", (req, res) => {
    const tokens = db
      .prepare("SELECT rowid AS id, label, created_at FROM sessions WHERE user_id = ? AND kind = 'api' ORDER BY created_at DESC")
      .all(uid(req));
    res.json({ tokens });
  });
  r.post("/tokens", (req, res) => {
    const { label } = parseBody(z.object({ label: z.string().trim().min(1).max(60).default("iOS Shortcuts") }), req.body);
    res.status(201).json({ token: createSession(db, uid(req), "api", label) });
  });
  r.delete("/tokens/:id", (req, res) => {
    const info = db.prepare("DELETE FROM sessions WHERE rowid = ? AND user_id = ? AND kind = 'api'").run(idParam(req), uid(req));
    if (!info.changes) notFound("Token");
    res.json({ ok: true });
  });

  // ---- Shortcuts endpoints: plain-text responses Siri can speak ----
  const shortcutLimiter = rateLimit({ windowMs: 60_000, max: 15, key: (req) => `sc:${req.user!.id}` });
  const ShortcutText = z.object({ text: z.string().trim().min(1).max(50_000) });

  r.post("/shortcuts/ask", shortcutLimiter, async (req, res) => {
    const { text } = parseBody(ShortcutText, req.body);
    const settings = getSettings(db, uid(req));
    let answer = "";
    let error = "";
    try {
      await runChat({
        db,
        provider,
        user: req.user!,
        settings: { ...settings, responseStyle: settings.responseStyle === "detailed" ? "balanced" : settings.responseStyle },
        conversationId: null,
        text,
        attachments: [],
        webSearch: settings.webSearch,
        send: (e) => {
          if (e.type === "text") answer += e.delta;
          if (e.type === "error") error = e.message;
        },
        signal: AbortSignal.timeout(110_000),
      });
    } catch (err) {
      error = describeAiError(err).message;
    }
    res.type("text/plain").status(error ? 502 : 200).send(error || answer.trim());
  });

  r.post("/shortcuts/task", shortcutLimiter, async (req, res) => {
    const { text } = parseBody(ShortcutText, req.body);
    const settings = getSettings(db, uid(req));
    try {
      const item = await parseNatural(provider, settings, text);
      const tz = safeTimeZone(settings.timezone);
      if (item.kind === "event" && item.at) {
        const e = store.createEvent(db, uid(req), { title: item.title, start_at: item.at, end_at: item.end, location: item.location, notes: item.notes });
        res.type("text/plain").send(`Event added: ${e.title}, ${formatUserTime(e.start_at, tz)}.`);
        return;
      }
      const t = store.createTask(db, uid(req), { title: item.title, priority: item.priority, due_at: item.at, notes: item.notes });
      res.type("text/plain").send(`Task added: ${t.title}${t.due_at ? `, due ${formatUserTime(t.due_at, tz)}` : ""}.`);
    } catch (err) {
      res.type("text/plain").status(502).send(describeAiError(err).message);
    }
  });

  r.get("/shortcuts/agenda", (req, res) => {
    const tz = safeTimeZone(getSettings(db, uid(req)).timezone);
    const start = Date.now();
    const events = store.listEvents(db, uid(req), start, start + 864e5);
    const tasks = store.listTasks(db, uid(req)).slice(0, 10);
    const lines: string[] = [];
    lines.push(events.length ? `You have ${events.length} event${events.length === 1 ? "" : "s"} in the next 24 hours.` : "No events in the next 24 hours.");
    for (const e of events) lines.push(`${formatUserTime(e.start_at, tz)}: ${e.title}.`);
    lines.push(tasks.length ? `Open tasks: ${tasks.map((t) => t.title).join("; ")}.` : "No open tasks.");
    res.type("text/plain").send(lines.join("\n"));
  });

  // ---- Export & account ----
  r.get("/export/notes.md", (req, res) => {
    const notes = store.listNotes(db, uid(req));
    const md = notes
      .map((n) => `# ${n.title}\n\n_Updated ${new Date(n.updated_at).toISOString()}_\n\n${n.body}\n`)
      .join("\n---\n\n");
    res.type("text/markdown; charset=utf-8").setHeader("Content-Disposition", 'attachment; filename="jarvis-notes.md"').send(md);
  });

  r.get("/export/all.json", (req, res) => {
    const id = uid(req);
    const conversations = (db.prepare("SELECT id, title, created_at FROM conversations WHERE user_id = ?").all(id) as any[]).map((c) => ({
      ...c,
      messages: db.prepare("SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id").all(c.id),
    }));
    res.setHeader("Content-Disposition", 'attachment; filename="jarvis-export.json"').json({
      exported_at: new Date().toISOString(),
      user: req.user,
      settings: getSettings(db, id),
      memories: store.listMemories(db, id),
      tasks: store.listTasks(db, id, { includeDone: true }),
      events: store.listEvents(db, id),
      notes: store.listNotes(db, id),
      conversations,
    });
  });

  r.delete("/account", (req, res) => {
    db.prepare("DELETE FROM users WHERE id = ?").run(uid(req));
    res.clearCookie("jarvis_session", { path: "/" }).json({ ok: true });
  });

  return r;
}
