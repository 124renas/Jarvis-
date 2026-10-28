import type Anthropic from "@anthropic-ai/sdk";
import type { DB } from "../db.js";
import { now } from "../db.js";
import type { AuthUser } from "../auth.js";
import type { Settings } from "../settings.js";
import { listMemories } from "../lib/store.js";
import { formatUserTime, safeTimeZone, tzOffset } from "../lib/time.js";
import { JARVIS_SYSTEM_PROMPT, userContextBlock } from "./prompt.js";
import { executeTool, toolDefinitions } from "./tools.js";
import type { AiProvider, BetaMessageParam } from "./provider.js";

type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

export interface Attachment {
  name: string;
  mediaType: string;
  /** base64 without a data: prefix */
  data: string;
}

export interface Source {
  title: string;
  url: string;
}

export interface MessageMeta {
  context?: string;
  attachments?: { name: string; mediaType: string }[];
  sources?: Source[];
  actions?: string[];
  stopped?: boolean;
  refused?: boolean;
  error?: string;
}

export type ChatEvent =
  | { type: "meta"; conversationId: number; userMessageId: number; title: string }
  | { type: "status"; status: string; detail?: string }
  | { type: "text"; delta: string }
  | { type: "action"; summary: string; changed?: string }
  | { type: "memory_proposal"; content: string; category: string }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; messageId: number }
  | { type: "error"; message: string };

const MAX_HISTORY = 120;
const MAX_TOOL_ROUNDS = 8;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
export const DOC_TYPES = ["application/pdf"];

function contextLine(tz: string): string {
  const zone = safeTimeZone(tz);
  return `<context>Current local time: ${formatUserTime(Date.now(), zone)} (${zone}, UTC${tzOffset(zone)})</context>`;
}

/** Rebuild a stored user message exactly as it was first sent (minus attachments). */
function storedUserContent(content: string, meta: MessageMeta): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (meta.context) blocks.push({ type: "text", text: meta.context });
  for (const a of meta.attachments ?? []) blocks.push({ type: "text", text: `[The user attached a file earlier: ${a.name}]` });
  blocks.push({ type: "text", text: content || "(no text)" });
  return blocks;
}

export function loadHistory(db: DB, conversationId: number): BetaMessageParam[] {
  const rows = db
    .prepare("SELECT role, content, meta FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?")
    .all(conversationId, MAX_HISTORY)
    .reverse() as { role: "user" | "assistant"; content: string; meta: string | null }[];
  // The API requires the first message to be from the user.
  while (rows.length && rows[0].role !== "user") rows.shift();
  return rows
    .filter((r) => r.role === "user" || r.content.trim())
    .map((r) => {
      const meta: MessageMeta = r.meta ? JSON.parse(r.meta) : {};
      return r.role === "user"
        ? { role: "user" as const, content: storedUserContent(r.content, meta) }
        : { role: "assistant" as const, content: r.content };
    });
}

function collectSources(content: Anthropic.Beta.BetaContentBlock[]): Source[] {
  const seen = new Map<string, Source>();
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.type === "web_search_result" && !seen.has(r.url)) seen.set(r.url, { title: r.title, url: r.url });
    }
    if (block.type === "text" && block.citations) {
      for (const c of block.citations) {
        if (c.type === "web_search_result_location" && !seen.has(c.url)) seen.set(c.url, { title: c.title ?? c.url, url: c.url });
      }
    }
  }
  return [...seen.values()];
}

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").replace(/^jarvis[,:]?\s*/i, "").trim();
  if (!clean) return "New conversation";
  const t = clean.length > 48 ? clean.slice(0, 47).replace(/\s+\S*$/, "") + "…" : clean;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export interface RunChatOptions {
  db: DB;
  provider: AiProvider;
  user: AuthUser;
  settings: Settings;
  conversationId: number | null;
  text: string;
  attachments: Attachment[];
  webSearch: boolean;
  send: (event: ChatEvent) => void;
  signal: AbortSignal;
}

export async function runChat(o: RunChatOptions): Promise<void> {
  const { db, user, settings } = o;
  const tz = settings.timezone;

  // Create or validate the conversation (always scoped to this user).
  let conversationId = o.conversationId;
  let title: string;
  if (conversationId) {
    const conv = db.prepare("SELECT id, title FROM conversations WHERE id = ? AND user_id = ?").get(conversationId, user.id) as
      | { id: number; title: string }
      | undefined;
    if (!conv) throw Object.assign(new Error("Conversation not found."), { status: 404 });
    title = conv.title;
  } else {
    title = titleFrom(o.text || o.attachments[0]?.name || "");
    const info = db
      .prepare("INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(user.id, title, now(), now());
    conversationId = Number(info.lastInsertRowid);
  }

  const history = loadHistory(db, conversationId);

  const context = contextLine(tz);
  const userMeta: MessageMeta = { context };
  if (o.attachments.length) userMeta.attachments = o.attachments.map((a) => ({ name: a.name, mediaType: a.mediaType }));
  const userMessageId = Number(
    db
      .prepare("INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?, 'user', ?, ?, ?)")
      .run(conversationId, o.text, JSON.stringify(userMeta), now()).lastInsertRowid,
  );
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), conversationId);
  o.send({ type: "meta", conversationId, userMessageId, title });

  const userContent: ContentBlock[] = [{ type: "text", text: context }];
  for (const a of o.attachments) {
    if (IMAGE_TYPES.includes(a.mediaType)) {
      userContent.push({ type: "image", source: { type: "base64", media_type: a.mediaType as any, data: a.data } });
    } else if (DOC_TYPES.includes(a.mediaType)) {
      userContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: a.name });
    }
  }
  userContent.push({ type: "text", text: o.text || "Please analyse the attached file." });

  const messages: BetaMessageParam[] = [...history, { role: "user", content: userContent }];
  const memories = settings.memoryEnabled ? listMemories(db, user.id) : [];
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: JARVIS_SYSTEM_PROMPT },
    { type: "text", text: userContextBlock(settings, memories, user.name) },
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] = [...toolDefinitions({ memory: settings.memoryEnabled })];
  if (o.webSearch) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });

  let answer = "";
  const sources = new Map<string, Source>();
  const actions: string[] = [];
  const meta: MessageMeta = {};

  const saveAssistant = () => {
    if (sources.size) meta.sources = [...sources.values()];
    if (actions.length) meta.actions = actions;
    const id = Number(
      db
        .prepare("INSERT INTO messages (conversation_id, role, content, meta, created_at) VALUES (?, 'assistant', ?, ?, ?)")
        .run(conversationId, answer, JSON.stringify(meta), now()).lastInsertRowid,
    );
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), conversationId);
    return id;
  };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let roundText = "";
      const separator = answer && !answer.endsWith("\n") ? "\n\n" : "";
      let sentSeparator = false;
      o.send({ type: "status", status: "thinking" });
      const response = await o.provider.streamTurn(
        { model: settings.model as any, effort: settings.effort, system, messages, tools },
        {
          onText: (delta) => {
            if (!sentSeparator && separator) {
              o.send({ type: "text", delta: separator });
              answer += separator;
              sentSeparator = true;
            }
            roundText += delta;
            answer += delta;
            o.send({ type: "text", delta });
          },
          onStatus: (status, detail) => o.send({ type: "status", status, detail }),
        },
        o.signal,
      );

      const found = collectSources(response.content);
      if (found.length) {
        for (const s of found) sources.set(s.url, s);
        o.send({ type: "sources", sources: [...sources.values()] });
      }

      if (response.stop_reason === "refusal") {
        meta.refused = true;
        const note = roundText ? "\n\n_(Response stopped by the AI provider's safety systems.)_" : "I'm sorry, but I can't help with that request.";
        answer += note;
        o.send({ type: "text", delta: note });
        break;
      }
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content as any });
        continue;
      }
      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        if (response.stop_reason === "max_tokens") {
          const note = "\n\n_(Response truncated — it reached the length limit.)_";
          answer += note;
          o.send({ type: "text", delta: note });
        }
        break;
      }

      messages.push({ role: "assistant", content: response.content as any });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const outcome = executeTool(db, user.id, tz, use.name, use.input);
        results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.content, is_error: outcome.isError || undefined });
        if (outcome.memoryProposal) o.send({ type: "memory_proposal", ...outcome.memoryProposal });
        if (outcome.summary && !outcome.isError) {
          actions.push(outcome.summary);
          o.send({ type: "action", summary: outcome.summary, changed: outcome.changed });
        }
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    if (o.signal.aborted) {
      meta.stopped = true;
      saveAssistant();
      return;
    }
    meta.error = err instanceof Error ? err.message : String(err);
    if (answer) saveAssistant();
    throw err;
  }

  const messageId = saveAssistant();
  o.send({ type: "done", messageId });
}
