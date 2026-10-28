import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db.js";
import { now } from "../db.js";
import { DOC_TYPES, IMAGE_TYPES, runChat, type ChatEvent } from "../ai/chat.js";
import { describeAiError, type AiProvider } from "../ai/provider.js";
import { getSettings } from "../settings.js";
import { HttpError, idParam, notFound, parseBody, rateLimit } from "../lib/http.js";

const ChatBody = z.object({
  conversationId: z.number().int().positive().nullable().optional(),
  text: z.string().max(100_000).default(""),
  webSearch: z.boolean().optional(),
  attachments: z
    .array(
      z.object({
        name: z.string().max(200),
        mediaType: z.enum([...IMAGE_TYPES, ...DOC_TYPES] as [string, ...string[]]),
        data: z.string().max(14_000_000),
      }),
    )
    .max(4)
    .default([]),
});

export function chatRoutes(db: DB, provider: AiProvider) {
  const r = Router();

  r.get("/conversations", (req, res) => {
    const rows = db
      .prepare(
        `SELECT c.id, c.title, c.created_at, c.updated_at,
           (SELECT substr(content, 1, 140) FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS preview
         FROM conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 500`,
      )
      .all(req.user!.id);
    res.json({ conversations: rows });
  });

  r.get("/conversations/:id", (req, res) => {
    const id = idParam(req);
    const conv = db.prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?").get(id, req.user!.id);
    if (!conv) notFound("Conversation");
    const messages = (
      db.prepare("SELECT id, role, content, meta, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC").all(id) as any[]
    ).map(({ meta, ...m }) => {
      const parsed = meta ? JSON.parse(meta) : {};
      delete parsed.context;
      return { ...m, meta: parsed };
    });
    res.json({ conversation: conv, messages });
  });

  r.post("/conversations", (req, res) => {
    const body = parseBody(z.object({ title: z.string().trim().min(1).max(120).default("New conversation") }), req.body);
    const info = db
      .prepare("INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(req.user!.id, body.title, now(), now());
    res.status(201).json({ conversation: { id: Number(info.lastInsertRowid), title: body.title } });
  });

  r.patch("/conversations/:id", (req, res) => {
    const id = idParam(req);
    const body = parseBody(z.object({ title: z.string().trim().min(1).max(120) }), req.body);
    const info = db.prepare("UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?").run(body.title, id, req.user!.id);
    if (!info.changes) notFound("Conversation");
    res.json({ ok: true });
  });

  r.delete("/conversations/:id", (req, res) => {
    const info = db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").run(idParam(req), req.user!.id);
    if (!info.changes) notFound("Conversation");
    res.json({ ok: true });
  });

  r.delete("/conversations", (req, res) => {
    const info = db.prepare("DELETE FROM conversations WHERE user_id = ?").run(req.user!.id);
    res.json({ deleted: info.changes });
  });

  const aiLimiter = rateLimit({ windowMs: 60_000, max: 20, key: (req) => `chat:${req.user!.id}` });

  // Streams the reply as Server-Sent Events over a POST response.
  r.post("/chat", aiLimiter, async (req, res) => {
    const body = parseBody(ChatBody, req.body);
    if (!body.text.trim() && body.attachments.length === 0) throw new HttpError(400, "Message is empty.");
    const settings = getSettings(db, req.user!.id);

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const send = (event: ChatEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });

    try {
      await runChat({
        db,
        provider,
        user: req.user!,
        settings,
        conversationId: body.conversationId ?? null,
        text: body.text,
        attachments: body.attachments,
        webSearch: body.webSearch ?? settings.webSearch,
        send,
        signal: abort.signal,
      });
    } catch (err: any) {
      if (!abort.signal.aborted) {
        const message = err?.status === 404 ? err.message : describeAiError(err).message;
        if (!(err?.status === 404)) console.error("[chat] error:", err);
        send({ type: "error", message });
      }
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  return r;
}
