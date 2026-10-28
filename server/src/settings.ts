import { z } from "zod";
import type { DB } from "./db.js";
import { DEFAULT_MODEL, MODELS } from "./config.js";

const modelIds = MODELS.map((m) => m.id) as [string, ...string[]];

export const SettingsSchema = z.object({
  model: z.enum(modelIds).default(DEFAULT_MODEL),
  effort: z.enum(["low", "medium", "high"]).default("medium"),
  webSearch: z.boolean().default(true),
  memoryEnabled: z.boolean().default(true),
  customInstructions: z.string().max(4000).default(""),
  responseStyle: z.enum(["balanced", "concise", "detailed"]).default("balanced"),
  autoSpeak: z.boolean().default(false),
  textOnly: z.boolean().default(false),
  voiceURI: z.string().max(300).default(""),
  speechRate: z.number().min(0.5).max(2).default(1),
  speechPitch: z.number().min(0.5).max(2).default(1),
  theme: z.enum(["system", "dark", "light"]).default("dark"),
  haptics: z.boolean().default(true),
  timezone: z.string().max(80).default("UTC"),
  addressAs: z.string().max(40).default(""),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function getSettings(db: DB, userId: number): Settings {
  const row = db.prepare("SELECT json FROM settings WHERE user_id = ?").get(userId) as { json: string } | undefined;
  let stored: unknown = {};
  try {
    stored = row ? JSON.parse(row.json) : {};
  } catch {
    stored = {};
  }
  const parsed = SettingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export function updateSettings(db: DB, userId: number, patch: unknown): Settings {
  const merged = { ...getSettings(db, userId), ...(patch as object) };
  const settings = SettingsSchema.parse(merged);
  db.prepare("INSERT INTO settings (user_id, json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json").run(
    userId,
    JSON.stringify(settings),
  );
  return settings;
}
