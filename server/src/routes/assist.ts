// Single-shot AI utilities: summarise, draft, and natural-language parsing of
// tasks and events.
import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db.js";
import { describeAiError, type AiProvider } from "../ai/provider.js";
import { getSettings, type Settings } from "../settings.js";
import { formatUserTime, isoInZone, parseUserDate, safeTimeZone, tzOffset } from "../lib/time.js";
import { HttpError, parseBody, rateLimit } from "../lib/http.js";

const SUMMARY_SYSTEM =
  "You are JARVIS, a precise assistant. Summarise the user's text faithfully: key points first as a short bullet list, then any action items. Do not add facts that are not in the text. Use Markdown.";

const PARSE_SYSTEM =
  "You convert a short natural-language request into a structured task or calendar event. Resolve relative dates against the current local time provided. Output ISO 8601 date-times with the user's UTC offset. Use null when something is not specified. Keep the title short and drop filler like 'remind me to'.";

const ParsedSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["task", "event"] },
    title: { type: "string" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    due_or_start: { type: ["string", "null"] },
    end: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
  },
  required: ["kind", "title", "priority", "due_or_start", "end", "location", "notes"],
  additionalProperties: false,
};

const Parsed = z.object({
  kind: z.enum(["task", "event"]),
  title: z.string(),
  priority: z.enum(["low", "medium", "high"]),
  due_or_start: z.string().nullable(),
  end: z.string().nullable(),
  location: z.string().nullable(),
  notes: z.string().nullable(),
});

export interface ParsedItem {
  kind: "task" | "event";
  title: string;
  priority: "low" | "medium" | "high";
  at: number | null;
  end: number | null;
  location: string;
  notes: string;
}

/** Very small offline parser used in demo mode. */
function heuristicParse(text: string, tz: string, hint?: "task" | "event"): ParsedItem {
  let title = text.replace(/^(remind me to|add (a )?task( to)?|todo:?|schedule|add)\s+/i, "").trim();
  const priority = /\b(urgent|asap|important|high priority)\b/i.test(text) ? "high" : /\blow priority\b/i.test(text) ? "low" : "medium";
  let at: number | null = null;
  const base = new Date();
  const time = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const day = /\btomorrow\b/i.test(text) ? 1 : /\btoday|tonight\b/i.test(text) ? 0 : null;
  if (day !== null || time) {
    const d = new Date(base.getTime() + (day ?? 0) * 864e5);
    let h = time ? Number(time[1]) % 12 : 9;
    if (time && /pm/i.test(time[3])) h += 12;
    const m = time?.[2] ?? "00";
    const date = isoInZone(d.getTime(), tz).slice(0, 10);
    at = parseUserDate(`${date}T${String(h).padStart(2, "0")}:${m}:00`, tz);
    title = title.replace(/\b(tomorrow|today|tonight)\b/gi, "").replace(time?.[0] ?? "", "").replace(/\s+/g, " ").trim();
  }
  title = title.replace(/\b(urgent|asap|high priority|low priority)\b/gi, "").replace(/\s+/g, " ").replace(/[,.\s]+$/, "").trim();
  return { kind: hint ?? "task", title: title || text, priority, at, end: null, location: "", notes: "" };
}

export async function parseNatural(provider: AiProvider, settings: Settings, text: string, hint?: "task" | "event"): Promise<ParsedItem> {
  const tz = safeTimeZone(settings.timezone);
  if (provider.name === "demo") return heuristicParse(text, tz, hint);
  const raw = await provider.complete({
    model: settings.model as any,
    effort: "low",
    maxTokens: 2000,
    jsonSchema: ParsedSchema,
    system: [{ type: "text", text: PARSE_SYSTEM }],
    messages: [
      {
        role: "user",
        content: `Current local time: ${formatUserTime(Date.now(), tz)} (${tz}, UTC${tzOffset(tz)}).${hint ? ` The user wants a ${hint}.` : ""}\n\nRequest: ${text}`,
      },
    ],
  });
  const p = Parsed.parse(JSON.parse(raw));
  return {
    kind: hint ?? p.kind,
    title: p.title,
    priority: p.priority,
    at: parseUserDate(p.due_or_start, tz),
    end: parseUserDate(p.end, tz),
    location: p.location ?? "",
    notes: p.notes ?? "",
  };
}

export function assistRoutes(db: DB, provider: AiProvider) {
  const r = Router();
  r.use(rateLimit({ windowMs: 60_000, max: 20, key: (req) => `assist:${req.user!.id}` }));

  r.post("/summarize", async (req, res) => {
    const body = parseBody(z.object({ text: z.string().trim().min(1).max(400_000), instruction: z.string().max(500).optional() }), req.body);
    const settings = getSettings(db, req.user!.id);
    try {
      const text = await provider.complete({
        model: settings.model as any,
        effort: "low",
        system: [{ type: "text", text: SUMMARY_SYSTEM }],
        messages: [{ role: "user", content: `${body.instruction ? body.instruction + "\n\n" : ""}<text>\n${body.text}\n</text>` }],
      });
      res.json({ text });
    } catch (err) {
      const e = describeAiError(err);
      throw new HttpError(e.status, e.message);
    }
  });

  r.post("/parse", async (req, res) => {
    const body = parseBody(z.object({ text: z.string().trim().min(1).max(2000), kind: z.enum(["task", "event"]).optional() }), req.body);
    try {
      res.json({ item: await parseNatural(provider, getSettings(db, req.user!.id), body.text, body.kind) });
    } catch (err) {
      const e = describeAiError(err);
      throw new HttpError(e.status, e.message);
    }
  });

  return r;
}
