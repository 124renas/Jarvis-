// On-device chat loop: same event protocol as the server's /api/chat, backed by
// Gemini and IndexedDB.
import { JARVIS_SYSTEM_PROMPT, userContextBlock } from "../../../shared/prompt";
import { formatUserTime, safeTimeZone, tzOffset } from "../../../shared/time";
import type { ChatEvent, Source } from "../lib/types";
import * as data from "./data";
import { GeminiError, streamGenerate, type Content, type Part } from "./gemini";
import { getKey, getProfile, getSettings } from "./settings";
import { declarations, executeTool } from "./tools";

const MAX_HISTORY = 120;
const MAX_TOOL_ROUNDS = 8;
const REFUSAL_REASONS = ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"];

const ON_DEVICE_NOTE =
  "This is the on-device edition of JARVIS powered by Google Gemini: data is stored only on this device, there is no calendar subscription feed, no Siri Shortcuts endpoints and no push reminders. Events can be added to Apple Calendar with the event's “Add to Calendar” button.";

export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").replace(/^jarvis[,:]?\s*/i, "").trim();
  if (!clean) return "New conversation";
  const t = clean.length > 48 ? clean.slice(0, 47).replace(/\s+\S*$/, "") + "…" : clean;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function contextLine(tz: string) {
  const zone = safeTimeZone(tz);
  return `<context>Current local time: ${formatUserTime(Date.now(), zone)} (${zone}, UTC${tzOffset(zone)})</context>`;
}

/** Gemini expects alternating turns that start with the user. */
function normalise(contents: Content[]): Content[] {
  const out: Content[] = [];
  for (const c of contents) {
    if (!out.length && c.role !== "user") continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === c.role) prev.parts = [...prev.parts, ...c.parts];
    else out.push({ role: c.role, parts: [...c.parts] });
  }
  return out;
}

interface Attachment {
  name: string;
  mediaType: string;
  data: string;
}

export async function localChat(
  body: { conversationId?: number | null; text?: string; webSearch?: boolean; attachments?: Attachment[] },
  send: (e: ChatEvent) => void,
  signal: AbortSignal,
) {
  const settings = await getSettings();
  const key = await getKey();
  const profile = await getProfile();
  const text = (body.text ?? "").trim();
  const attachments = body.attachments ?? [];
  if (!key) {
    send({ type: "error", message: "Add your free Gemini API key in Settings › Intelligence to talk to JARVIS." });
    return;
  }

  let conversationId = body.conversationId ?? null;
  let title: string;
  if (conversationId) {
    const conv = await data.conversations.get(conversationId);
    if (!conv) {
      send({ type: "error", message: "Conversation not found." });
      return;
    }
    title = conv.title;
  } else {
    title = titleFrom(text || attachments[0]?.name || "");
    const conv = await data.conversations.put({ title, created_at: Date.now(), updated_at: Date.now() });
    conversationId = conv.id;
  }

  const history = (await data.conversationMessages(conversationId)).slice(-MAX_HISTORY);
  const context = contextLine(settings.timezone);
  const userMeta: Record<string, unknown> = { context };
  if (attachments.length) userMeta.attachments = attachments.map((a) => ({ name: a.name, mediaType: a.mediaType }));
  const userMsg = await data.messages.put({ conversation_id: conversationId, role: "user", content: text, meta: userMeta, created_at: Date.now() });
  await data.conversations.put({ ...(await data.conversations.get(conversationId))!, updated_at: Date.now() });
  send({ type: "meta", conversationId, userMessageId: userMsg.id, title });

  const contents: Content[] = history
    .filter((m) => m.role === "user" || m.content.trim())
    .map((m) =>
      m.role === "user"
        ? {
            role: "user",
            parts: [
              ...(m.meta.context ? [{ text: m.meta.context }] : []),
              ...((m.meta.attachments ?? []) as { name: string }[]).map((a) => ({ text: `[The user attached a file earlier: ${a.name}]` })),
              { text: m.content || "(no text)" },
            ],
          }
        : { role: "model", parts: [{ text: m.content }] },
    );
  contents.push({
    role: "user",
    parts: [
      { text: context },
      ...attachments.map((a) => ({ inlineData: { mimeType: a.mediaType, data: a.data } })),
      { text: text || "Please analyse the attached file." },
    ],
  });

  const memories = settings.memoryEnabled ? await data.listMemories() : [];
  const system = `${JARVIS_SYSTEM_PROMPT}\n\n${userContextBlock(settings, memories, profile?.name ?? "", ON_DEVICE_NOTE)}`;
  const web = body.webSearch ?? settings.webSearch;
  const functions = declarations({ memory: settings.memoryEnabled, web });

  let answer = "";
  const sources = new Map<string, Source>();
  const actions: string[] = [];
  const meta: Record<string, unknown> = {};

  const save = async () => {
    if (sources.size) meta.sources = [...sources.values()];
    if (actions.length) meta.actions = actions;
    const msg = await data.messages.put({ conversation_id: conversationId!, role: "assistant", content: answer, meta, created_at: Date.now() });
    const conv = await data.conversations.get(conversationId!);
    if (conv) await data.conversations.put({ ...conv, updated_at: Date.now() });
    return msg.id;
  };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let roundText = "";
      let separatorSent = !answer || answer.endsWith("\n");
      send({ type: "status", status: "thinking" });
      const result = await streamGenerate({
        key,
        model: settings.model,
        system,
        contents: normalise(contents),
        functions,
        signal,
        onText: (delta) => {
          if (!separatorSent) {
            separatorSent = true;
            answer += "\n\n";
            send({ type: "text", delta: "\n\n" });
          }
          if (!roundText) send({ type: "status", status: "writing" });
          roundText += delta;
          answer += delta;
          send({ type: "text", delta });
        },
      });

      if (result.blockReason || REFUSAL_REASONS.includes(result.finishReason)) {
        meta.refused = true;
        const note = roundText ? "\n\n_(Response stopped by Gemini's safety filters.)_" : "I'm sorry, but I can't help with that request.";
        answer += note;
        send({ type: "text", delta: note });
        break;
      }

      const calls = result.parts.filter((p): p is Part & { functionCall: NonNullable<Part["functionCall"]> } => !!p.functionCall);
      if (!calls.length) {
        if (result.finishReason === "MAX_TOKENS") {
          const note = "\n\n_(Response truncated — it reached the length limit.)_";
          answer += note;
          send({ type: "text", delta: note });
        }
        break;
      }

      // Replay the model turn exactly (including thought signatures), then answer each call.
      contents.push({ role: "model", parts: result.parts });
      const responses: Part[] = [];
      for (const call of calls) {
        send({ type: "status", status: call.functionCall.name === "web_search" ? "searching" : "tool", detail: call.functionCall.name });
        let outcome;
        try {
          outcome = await executeTool(call.functionCall.name, call.functionCall.args ?? {}, { tz: settings.timezone, key, model: settings.model, signal });
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          outcome = { response: { error: (err as Error).message }, isError: true };
        }
        responses.push({
          functionResponse: { name: call.functionCall.name, response: outcome.response, ...(call.functionCall.id ? { id: call.functionCall.id } : {}) },
        });
        if ("memoryProposal" in outcome && outcome.memoryProposal) send({ type: "memory_proposal", ...outcome.memoryProposal });
        if ("sources" in outcome && outcome.sources?.length) {
          for (const s of outcome.sources) sources.set(s.url, s);
          send({ type: "sources", sources: [...sources.values()] });
        }
        if ("summary" in outcome && outcome.summary && !outcome.isError) {
          actions.push(outcome.summary);
          send({ type: "action", summary: outcome.summary, changed: "changed" in outcome ? outcome.changed : undefined });
        }
      }
      contents.push({ role: "user", parts: responses });
    }
  } catch (err) {
    if (signal.aborted || (err as Error).name === "AbortError") {
      meta.stopped = true;
      await save();
      return;
    }
    const message = err instanceof GeminiError ? err.message : "Something went wrong while generating a response.";
    meta.error = message;
    if (answer) await save();
    send({ type: "error", message });
    return;
  }

  const messageId = await save();
  send({ type: "done", messageId });
}
