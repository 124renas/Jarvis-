import { useCallback, useEffect, useState } from "react";
import { ConversationList } from "./components/ConversationList";
import { Icon } from "./components/Icon";
import { Orb } from "./components/Orb";
import { ConfirmHost, Sheet, Spinner, Toasts } from "./components/ui";
import { api, STANDALONE } from "./lib/api";
import { haptic } from "./lib/haptics";
import { AppProvider, applyTheme, useApp } from "./lib/store";
import type { User, View } from "./lib/types";
import { AssistantView } from "./views/AssistantView";
import { AuthView } from "./views/AuthView";
import { SetupView } from "./views/SetupView";
import { CalendarView } from "./views/CalendarView";
import { NotesView } from "./views/NotesView";
import { SettingsView } from "./views/SettingsView";
import { TasksView } from "./views/TasksView";

const NAV: { view: View; label: string; icon: string }[] = [
  { view: "assistant", label: "JARVIS", icon: "orb" },
  { view: "tasks", label: "Tasks", icon: "tasks" },
  { view: "calendar", label: "Calendar", icon: "calendar" },
  { view: "notes", label: "Notes", icon: "notes" },
  { view: "settings", label: "Settings", icon: "settings" },
];

/** iPad (and landscape) gets the split view; iPhone gets the compact tab layout. */
function useWide() {
  const query = "(min-width: 744px)";
  const [wide, setWide] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function App() {
  const [session, setSession] = useState<{ user: User | null; signupAllowed: boolean } | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const load = useCallback(() => {
    setBootError(null);
    api<{ user: User | null; signupAllowed: boolean }>("/auth/session")
      .then(setSession)
      .catch((e) => setBootError(e.message));
  }, []);

  useEffect(() => {
    applyTheme("dark");
    load();
  }, [load]);

  const signOut = useCallback(() => {
    setSession((s) => ({ user: null, signupAllowed: s?.signupAllowed ?? false }));
    api<{ user: User | null; signupAllowed: boolean }>("/auth/session").then(setSession).catch(() => {});
  }, []);

  if (bootError)
    return (
      <main className="boot">
        <Orb state="idle" size={140} />
        <p>{bootError}</p>
        <button type="button" className="btn" onClick={load}>
          Retry
        </button>
      </main>
    );
  if (!session)
    return (
      <main className="boot">
        <Orb state="thinking" size={140} />
        <Spinner label="Starting JARVIS" />
      </main>
    );
  if (!session.user) {
    const onSignedIn = (user: User) => setSession({ user, signupAllowed: session.signupAllowed });
    return STANDALONE ? <SetupView onSignedIn={onSignedIn} /> : <AuthView signupAllowed={session.signupAllowed} onSignedIn={onSignedIn} />;
  }

  return (
    <AppProvider key={session.user.id} user={session.user} onSignOut={signOut}>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { view, setView, online, setActiveId } = useApp();
  const wide = useWide();
  const [historyOpen, setHistoryOpen] = useState(false);

  // Hardware-keyboard shortcuts for iPad: ⌘K new chat, ⌘1–5 switch sections.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setActiveId(null);
        setView("assistant");
      }
      const n = Number(e.key);
      if (n >= 1 && n <= NAV.length) {
        e.preventDefault();
        setView(NAV[n - 1].view);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView, setActiveId]);

  const go = (v: View) => {
    haptic("light");
    setView(v);
  };

  return (
    <div className={`shell ${wide ? "wide" : "compact"}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {!online && (
        <div className="offline-banner" role="status">
          <Icon name="wifiOff" size={16} /> Offline — showing saved data. AI features return when you reconnect.
        </div>
      )}

      {wide && (
        <aside className="sidebar glass" aria-label="Navigation">
          <div className="sidebar-brand">
            <Orb state="idle" size={44} />
            <div>
              <strong className="brand-word small">J.A.R.V.I.S.</strong>
              <span className="muted small">Personal AI</span>
            </div>
          </div>
          <nav className="side-nav">
            {NAV.map((n, i) => (
              <button key={n.view} type="button" className={view === n.view ? "active" : ""} onClick={() => go(n.view)} aria-current={view === n.view ? "page" : undefined} title={`⌘${i + 1}`}>
                <Icon name={n.icon} size={20} /> {n.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-section">
            <p className="eyebrow">Conversations</p>
            <ConversationList />
          </div>
        </aside>
      )}

      <main id="main" className="main">
        {view === "assistant" && <AssistantView compact={!wide} onOpenHistory={() => setHistoryOpen(true)} />}
        {view === "tasks" && <TasksView />}
        {view === "calendar" && <CalendarView />}
        {view === "notes" && <NotesView compact={!wide} />}
        {view === "settings" && <SettingsView />}
      </main>

      {!wide && (
        <nav className="tabbar glass" aria-label="Sections">
          {NAV.map((n) => (
            <button key={n.view} type="button" className={view === n.view ? "active" : ""} onClick={() => go(n.view)} aria-current={view === n.view ? "page" : undefined}>
              <Icon name={n.icon} size={22} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      )}

      {historyOpen && !wide && (
        <Sheet title="Conversations" onClose={() => setHistoryOpen(false)}>
          <ConversationList onPicked={() => setHistoryOpen(false)} />
        </Sheet>
      )}
      <ConfirmHost />
      <Toasts />
    </div>
  );
}
