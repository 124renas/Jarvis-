import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { setHapticsEnabled } from "./haptics";
import { speaker } from "./voice";
import type { Conversation, Settings, Status, User, View } from "./types";

export type DataKind = "tasks" | "events" | "notes" | "memories";

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "success";
}

interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface AppState {
  user: User;
  setUser(u: User | null): void;
  settings: Settings;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  status: Status | null;
  online: boolean;
  view: View;
  setView(v: View): void;
  conversations: Conversation[];
  refreshConversations(): Promise<void>;
  activeId: number | null;
  setActiveId(id: number | null): void;
  versions: Record<DataKind, number>;
  bump(kind: DataKind): void;
  toast(text: string, kind?: Toast["kind"]): void;
  toasts: Toast[];
  confirm(req: Omit<ConfirmRequest, "resolve">): Promise<boolean>;
  confirmRequest: ConfirmRequest | null;
  pendingPrompt: { text: string; send: boolean } | null;
  setPendingPrompt(p: { text: string; send: boolean } | null): void;
}

const Ctx = createContext<AppState | null>(null);

export const DEFAULT_SETTINGS: Settings = {
  model: "claude-opus-5-5",
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

const VIEWS: View[] = ["assistant", "tasks", "calendar", "notes", "settings"];

function initialView(): View {
  const v = new URLSearchParams(location.search).get("view") as View | null;
  return v && VIEWS.includes(v) ? v : "assistant";
}

export function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#030712" : "#eef4fb");
}

export function AppProvider({ user: initialUser, onSignOut, children }: { user: User; onSignOut(): void; children: ReactNode }) {
  const [user, setUserState] = useState(initialUser);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<Status | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [view, setViewState] = useState<View>(initialView);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [versions, setVersions] = useState<Record<DataKind, number>>({ tasks: 0, events: 0, notes: 0, memories: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<{ text: string; send: boolean } | null>(() => {
    const q = new URLSearchParams(location.search).get("q");
    return q ? { text: q, send: new URLSearchParams(location.search).get("send") === "1" } : null;
  });
  const toastId = useRef(0);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const { conversations } = await api<{ conversations: Conversation[] }>("/conversations");
      setConversations(conversations);
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  useEffect(() => {
    // Strip one-shot URL params (from Shortcuts / notifications) after reading them.
    if (location.search) history.replaceState(null, "", location.pathname);
    api<{ settings: Settings }>("/settings")
      .then(({ settings: s }) => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setSettings(s);
        // Keep the server's timezone in sync with the device for date parsing.
        if (tz && s.timezone !== tz) api("/settings", { method: "PATCH", body: { timezone: tz } }).then((r) => setSettings(r.settings)).catch(() => {});
      })
      .catch(() => {});
    api<Status>("/status").then(setStatus).catch(() => {});
    refreshConversations();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const unauthorized = () => onSignOut();
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("jarvis:unauthorized", unauthorized);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("jarvis:unauthorized", unauthorized);
    };
  }, [refreshConversations, onSignOut]);

  useEffect(() => {
    applyTheme(settings.theme);
    setHapticsEnabled(settings.haptics);
    speaker.opts = { voiceURI: settings.voiceURI, rate: settings.speechRate, pitch: settings.speechPitch };
    if (settings.theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings]);

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const previous = settings;
      setSettings({ ...settings, ...patch });
      try {
        const r = await api<{ settings: Settings }>("/settings", { method: "PATCH", body: patch });
        setSettings(r.settings);
      } catch (e) {
        setSettings(previous);
        toast((e as Error).message, "error");
      }
    },
    [settings, toast],
  );

  const setView = useCallback((v: View) => {
    setViewState(v);
    window.scrollTo(0, 0);
  }, []);

  const bump = useCallback((kind: DataKind) => setVersions((v) => ({ ...v, [kind]: v[kind] + 1 })), []);

  const confirm = useCallback(
    (req: Omit<ConfirmRequest, "resolve">) =>
      new Promise<boolean>((resolve) =>
        setConfirmRequest({
          ...req,
          resolve: (ok) => {
            setConfirmRequest(null);
            resolve(ok);
          },
        }),
      ),
    [],
  );

  const setUser = useCallback((u: User | null) => (u ? setUserState(u) : onSignOut()), [onSignOut]);

  const value = useMemo<AppState>(
    () => ({
      user,
      setUser,
      settings,
      saveSettings,
      status,
      online,
      view,
      setView,
      conversations,
      refreshConversations,
      activeId,
      setActiveId,
      versions,
      bump,
      toast,
      toasts,
      confirm,
      confirmRequest,
      pendingPrompt,
      setPendingPrompt,
    }),
    [user, setUser, settings, saveSettings, status, online, view, setView, conversations, refreshConversations, activeId, versions, bump, toast, toasts, confirm, confirmRequest, pendingPrompt],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

/** Fetch helper that refetches when a data kind is bumped. */
export function useData<T>(path: string | null, kind: DataKind | null, initial: T) {
  const { versions } = useApp();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const version = kind ? versions[kind] : 0;
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setError(null);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === "AbortError") return;
        setError(e.message);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, version, reloadKey]);

  return { data, setData, loading, error, reload: () => setReloadKey((k) => k + 1) };
}
