export interface User {
  id: number;
  email: string;
  name: string;
}

export interface Settings {
  model: string;
  effort: "low" | "medium" | "high";
  webSearch: boolean;
  memoryEnabled: boolean;
  customInstructions: string;
  responseStyle: "balanced" | "concise" | "detailed";
  autoSpeak: boolean;
  textOnly: boolean;
  voiceURI: string;
  speechRate: number;
  speechPitch: number;
  theme: "system" | "dark" | "light";
  haptics: boolean;
  timezone: string;
  addressAs: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  note: string;
}

export interface Status {
  ai: "anthropic" | "demo";
  models: ModelInfo[];
  pushDevices: number;
  vapidPublicKey: string;
}

export interface Conversation {
  id: number;
  title: string;
  created_at: number;
  updated_at: number;
  preview?: string | null;
}

export interface Source {
  title: string;
  url: string;
}

export interface MessageMeta {
  attachments?: { name: string; mediaType: string }[];
  sources?: Source[];
  actions?: string[];
  stopped?: boolean;
  refused?: boolean;
  error?: string;
}

export interface MemoryProposal {
  content: string;
  category: string;
  state?: "saved" | "dismissed";
}

export interface ChatMessage {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  meta: MessageMeta;
  created_at: number;
  pending?: boolean;
  memoryProposals?: MemoryProposal[];
  error?: string;
}

export interface Task {
  id: number;
  title: string;
  notes: string;
  priority: "low" | "medium" | "high";
  due_at: number | null;
  done: boolean;
  created_at: number;
}

export interface CalendarEvent {
  id: number;
  title: string;
  start_at: number;
  end_at: number | null;
  all_day: boolean;
  location: string;
  notes: string;
}

export interface Note {
  id: number;
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

export interface Memory {
  id: number;
  content: string;
  category: string;
  created_at: number;
}

export interface ParsedItem {
  kind: "task" | "event";
  title: string;
  priority: "low" | "medium" | "high";
  at: number | null;
  end: number | null;
  location: string;
  notes: string;
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

export type View = "assistant" | "tasks" | "calendar" | "notes" | "settings";
