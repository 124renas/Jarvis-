// Minimal Google Gemini REST client used by the on-device edition. The user's
// own API key (from Google AI Studio) is stored on their device and sent only
// to Google.

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}

export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export class GeminiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function toError(res: Response): Promise<GeminiError> {
  let detail = "";
  let reason = "";
  try {
    const body = await res.json();
    detail = body?.error?.message ?? "";
    reason = body?.error?.details?.find((d: any) => d.reason)?.reason ?? body?.error?.status ?? "";
  } catch {
    /* not JSON */
  }
  if (reason === "API_KEY_INVALID" || /api key not valid/i.test(detail)) {
    return new GeminiError(401, "Your Gemini API key isn't valid. Update it in Settings › Intelligence.");
  }
  if (res.status === 429) {
    return new GeminiError(429, "Gemini's free-tier limit was reached. Wait a minute (daily limits reset overnight) or pick a lighter model in Settings.");
  }
  if (res.status === 404) return new GeminiError(404, "That Gemini model isn't available to your key. Choose another model in Settings.");
  if (res.status === 403) return new GeminiError(403, `Gemini refused the request: ${detail || "permission denied"}.`);
  if (res.status >= 500) return new GeminiError(503, "Gemini is temporarily unavailable or overloaded. Please try again shortly.");
  return new GeminiError(res.status, detail || `Gemini request failed (${res.status}).`);
}

async function post(path: string, key: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new GeminiError(0, navigator.onLine ? "Couldn't reach Gemini. Check your connection." : "You're offline.");
  }
  if (!res.ok) throw await toError(res);
  return res;
}

export interface StreamResult {
  parts: Part[];
  finishReason: string;
  blockReason?: string;
}

/** Streams a reply; text arrives via onText, the raw parts are returned for replay. */
export async function streamGenerate(opts: {
  key: string;
  model: string;
  system: string;
  contents: Content[];
  functions?: FunctionDeclaration[];
  onText(delta: string): void;
  signal?: AbortSignal;
}): Promise<StreamResult> {
  const res = await post(
    `models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`,
    opts.key,
    {
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: opts.contents,
      ...(opts.functions?.length ? { tools: [{ functionDeclarations: opts.functions }] } : {}),
    },
    opts.signal,
  );
  const parts: Part[] = [];
  let finishReason = "";
  let blockReason: string | undefined;
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const handle = (json: any) => {
    if (json.promptFeedback?.blockReason) blockReason = json.promptFeedback.blockReason;
    const cand = json.candidates?.[0];
    if (!cand) return;
    if (cand.finishReason) finishReason = cand.finishReason;
    for (const p of (cand.content?.parts ?? []) as Part[]) {
      parts.push(p);
      if (p.text && !p.thought) opts.onText(p.text);
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r/g, "");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          handle(JSON.parse(line.slice(5).trim()));
        } catch {
          /* ignore malformed chunk */
        }
      }
    }
  }
  return { parts, finishReason, blockReason };
}

/** Non-streaming call; optionally constrained to a JSON schema or grounded with Google Search. */
export async function generate(opts: {
  key: string;
  model: string;
  system?: string;
  contents: Content[];
  jsonSchema?: Record<string, unknown>;
  googleSearch?: boolean;
  signal?: AbortSignal;
}): Promise<{ text: string; sources: { title: string; url: string }[] }> {
  const res = await post(
    `models/${encodeURIComponent(opts.model)}:generateContent`,
    opts.key,
    {
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      contents: opts.contents,
      ...(opts.googleSearch ? { tools: [{ google_search: {} }] } : {}),
      ...(opts.jsonSchema ? { generationConfig: { responseMimeType: "application/json", responseSchema: opts.jsonSchema } } : {}),
    },
    opts.signal,
  );
  const json = await res.json();
  const cand = json.candidates?.[0];
  if (!cand || json.promptFeedback?.blockReason) throw new GeminiError(422, "Gemini declined this request.");
  const text = ((cand.content?.parts ?? []) as Part[])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");
  const sources = ((cand.groundingMetadata?.groundingChunks ?? []) as any[])
    .map((c) => c.web)
    .filter((w) => w?.uri)
    .map((w) => ({ title: w.title ?? w.uri, url: w.uri }));
  return { text, sources };
}

export interface GeminiModel {
  id: string;
  label: string;
  note: string;
}

/** Chat-capable Gemini models available to this key. */
export async function listModels(key: string): Promise<GeminiModel[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  } catch {
    throw new GeminiError(0, "Couldn't reach Gemini. Check your connection.");
  }
  if (!res.ok) throw await toError(res);
  const { models = [] } = await res.json();
  return (models as any[])
    .filter(
      (m) =>
        m.supportedGenerationMethods?.includes("generateContent") &&
        /gemini/i.test(m.name) &&
        !/(embedding|image|tts|audio|live|robotics|computer|vision|aqa)/i.test(m.name),
    )
    .map((m) => ({ id: String(m.name).replace(/^models\//, ""), label: m.displayName ?? m.name, note: "" }));
}
