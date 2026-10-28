import { kv } from "./idb";
import { DEFAULT_GEMINI_MODEL } from "./gemini";
import type { Settings } from "../lib/types";

export const LOCAL_DEFAULTS: Settings = {
  model: DEFAULT_GEMINI_MODEL,
  effort: "medium",
  webSearch: true,
  memoryEnabled: true,
  customInstructions: "",
  responseStyle: "balanced",
  autoSpeak: false,
  textOnly: false,
  voiceURI: "",
  speechRate: 1,
  speechPitch: 1,
  theme: "dark",
  haptics: true,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  addressAs: "",
};

export async function getSettings(): Promise<Settings> {
  return { ...LOCAL_DEFAULTS, ...((await kv.get<Partial<Settings>>("settings")) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await kv.set("settings", next);
  return next;
}

export const getKey = async () => (await kv.get<string>("geminiKey")) ?? "";
export const setKey = (key: string) => kv.set("geminiKey", key.trim());

export interface Profile {
  name: string;
  created_at: number;
}
export const getProfile = () => kv.get<Profile>("profile");
export const setProfile = (p: Profile) => kv.set("profile", p);
