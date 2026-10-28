// Demo provider: used when no ANTHROPIC_API_KEY is configured. It never
// pretends to be the real model — every reply says it is a demo — but it does
// exercise streaming and the tool loop so the whole app can be tried and
// tested end to end.
import type { AiProvider, BetaMessage, BetaMessageParam } from "./provider.js";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  });

function lastUserText(messages: BetaMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const texts = m.content.filter((b: any) => b.type === "text").map((b: any) => b.text as string);
    if (texts.length) return texts[texts.length - 1];
    return "";
  }
  return "";
}

function message(content: any[], stop_reason: string): BetaMessage {
  return {
    id: `msg_demo_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model: "demo",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as BetaMessage;
}

function plan(messages: BetaMessageParam[]): { tool?: { name: string; input: any }; text: string } {
  const last = messages[messages.length - 1];
  const isToolResult = Array.isArray(last?.content) && last.content.some((b: any) => b.type === "tool_result");
  if (isToolResult) {
    const result = (last.content as any[]).find((b) => b.type === "tool_result");
    return { text: `Done. ${result?.is_error ? "That didn't work: " + result.content : "I've taken care of that."}\n\n_Demo mode — connect an API key for real intelligence._` };
  }
  const text = lastUserText(messages).trim();
  const task = text.match(/^(?:jarvis,?\s*)?(?:add (?:a )?task|remind me to)\s+(.+)$/i);
  if (task) {
    return {
      tool: { name: "create_task", input: { title: task[1].replace(/[.!]$/, ""), priority: "medium", due_at: null, notes: null } },
      text: "Certainly. Adding that to your tasks.",
    };
  }
  const note = text.match(/^(?:jarvis,?\s*)?(?:take a note|note)[:\s]+(.+)$/i);
  if (note) {
    return { tool: { name: "create_note", input: { title: note[1].slice(0, 60), body: note[1] } }, text: "Of course. Saving a note." };
  }
  return {
    text: [
      "**JARVIS demo mode.** No AI model is connected yet, so this is a scripted reply rather than a real answer.",
      "",
      `You said: “${text.slice(0, 200)}”`,
      "",
      "To enable real conversations, set `ANTHROPIC_API_KEY` on the server and restart it. Things you can try in demo mode:",
      "- *“Add task buy groceries”* — creates a real task",
      "- *“Take a note: call the bank on Monday”* — saves a real note",
      "- The microphone, voice playback, tasks, calendar and notes screens all work normally.",
      "",
      "```js\n// Code blocks render like this\nconsole.log('JARVIS systems online');\n```",
    ].join("\n"),
  };
}

export function demoProvider(): AiProvider {
  return {
    name: "demo",
    async streamTurn(req, handlers, signal) {
      const p = plan(req.messages);
      handlers.onStatus?.("writing");
      for (const word of p.text.split(/(?<=\s)/)) {
        await sleep(12, signal);
        handlers.onText(word);
      }
      if (p.tool) {
        handlers.onStatus?.("tool", p.tool.name);
        return message(
          [
            { type: "text", text: p.text, citations: null },
            { type: "tool_use", id: `toolu_demo_${Date.now()}`, name: p.tool.name, input: p.tool.input },
          ],
          "tool_use",
        );
      }
      return message([{ type: "text", text: p.text, citations: null }], "end_turn");
    },
    async complete(req) {
      const text = lastUserText(req.messages);
      return `**Demo mode** — no AI model is connected, so this is not a real result.\n\nInput received (${text.length} characters). Set \`ANTHROPIC_API_KEY\` on the server to enable this feature.`;
    },
  };
}
