import Anthropic from "@anthropic-ai/sdk";
import { config, type ModelId } from "../config.js";
import { demoProvider } from "./demo.js";

export type BetaMessage = Anthropic.Beta.BetaMessage;
export type BetaMessageParam = Anthropic.Beta.BetaMessageParam;

export interface TurnRequest {
  model: ModelId;
  effort: "low" | "medium" | "high";
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: BetaMessageParam[];
  tools: Anthropic.Beta.BetaToolUnion[];
  maxTokens?: number;
  /** JSON schema for structured output (utility endpoints only). */
  jsonSchema?: Record<string, unknown>;
}

export interface TurnHandlers {
  onText(delta: string): void;
  onStatus?(status: "searching" | "tool" | "writing", detail?: string): void;
}

export interface AiProvider {
  readonly name: "anthropic" | "demo";
  streamTurn(req: TurnRequest, handlers: TurnHandlers, signal: AbortSignal): Promise<BetaMessage>;
  /** Single non-streaming request returning plain text (used by utility endpoints). */
  complete(req: Omit<TurnRequest, "tools">, signal?: AbortSignal): Promise<string>;
}

// Server-side refusal fallback ("default" routes by refusal category) is
// available for Opus 5.5 and Sonnet 5.5 on the Claude API; Haiku 5.5 has none.
function fallbackParams(model: ModelId) {
  if (model === "claude-haiku-5-5") return {};
  return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
}

export function anthropicProvider(apiKey: string, clientOptions: Omit<ConstructorParameters<typeof Anthropic>[0], "apiKey"> = {}): AiProvider {
  const client = new Anthropic({ apiKey, ...clientOptions });

  return {
    name: "anthropic",

    async streamTurn(req, handlers, signal) {
      const stream = client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens ?? 64000,
          // Thinking is adaptive by default on these models; effort controls depth.
          output_config: { effort: req.effort },
          cache_control: { type: "ephemeral" },
          system: req.system,
          messages: req.messages,
          tools: req.tools,
          ...fallbackParams(req.model),
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const type = event.content_block.type;
          if (type === "server_tool_use") handlers.onStatus?.("searching");
          else if (type === "tool_use") handlers.onStatus?.("tool", event.content_block.name);
          else if (type === "text") handlers.onStatus?.("writing");
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          handlers.onText(event.delta.text);
        }
      }
      return stream.finalMessage();
    },

    async complete(req, signal) {
      const message = await client.beta.messages
        .stream(
          {
            model: req.model,
            max_tokens: req.maxTokens ?? 16000,
            output_config: {
              effort: req.effort,
              ...(req.jsonSchema ? { format: { type: "json_schema" as const, schema: req.jsonSchema } } : {}),
            },
            system: req.system,
            messages: req.messages,
            ...fallbackParams(req.model),
          },
          { signal },
        )
        .finalMessage();
      if (message.stop_reason === "refusal") throw new RefusalError();
      return message.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    },
  };
}

export class RefusalError extends Error {
  constructor() {
    super("The request was declined by the AI provider's safety systems.");
  }
}

export function createProvider(): AiProvider {
  return config.demoMode ? demoProvider() : anthropicProvider(config.anthropicKey);
}

/** Convert provider errors into short, user-facing messages. */
export function describeAiError(err: unknown): { status: number; message: string } {
  if (err instanceof RefusalError) return { status: 422, message: err.message };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { status: 502, message: "The AI service rejected the server's credentials. Check ANTHROPIC_API_KEY on the server." };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "The AI service is rate-limiting requests. Please try again in a moment." };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `The AI service could not process this request: ${err.message}` };
  }
  if (err instanceof Anthropic.InternalServerError || (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500)) {
    return { status: 503, message: "The AI service is temporarily unavailable or overloaded. Please try again shortly." };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { status: 503, message: "The server could not reach the AI service. Check its internet connection." };
  }
  return { status: 500, message: "Something went wrong while generating a response." };
}
