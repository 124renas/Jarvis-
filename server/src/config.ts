import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: process.env.DATA_DIR ?? path.join(root, "data"),
  webDist: path.join(root, "web", "dist"),
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  /** Demo mode streams canned replies so the UI can be explored and tested without an API key. */
  demoMode: process.env.JARVIS_DEMO === "1" || !process.env.ANTHROPIC_API_KEY,
  /** Set to "1" to allow new sign-ups. Defaults to open until the first account exists. */
  allowSignup: process.env.ALLOW_SIGNUP,
  cookieSecure: process.env.COOKIE_SECURE === "1",
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    subject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  },
};

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Most capable (default)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Fast and capable" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Fastest, lowest cost" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"];
export const DEFAULT_MODEL: ModelId = "claude-opus-5-5";
