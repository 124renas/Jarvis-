import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { PageHeader, Sheet, Toggle } from "../components/ui";
import { api, download } from "../lib/api";
import { isIOS, isStandalone } from "../lib/format";
import { haptic } from "../lib/haptics";
import { disablePush, enablePush, hasPushSubscription, pushSupportMessage } from "../lib/push";
import { useApp, useData } from "../lib/store";
import type { Memory, Settings } from "../lib/types";
import { defaultVoice, listVoices, onVoicesChanged, speaker, sttSupported, ttsSupported, unlockSpeech } from "../lib/voice";

export function SettingsView() {
  const { settings, saveSettings, status, user, setUser, toast, confirm, refreshConversations, setActiveId } = useApp();

  return (
    <section className="page settings" aria-label="Settings">
      <PageHeader title="Settings" subtitle={user.email} />

      <Card title="Profile" icon="orb">
        <ProfileForm />
      </Card>

      <Card title="Intelligence" icon="sparkle">
        <label className="field">
          <span>AI model</span>
          <select value={settings.model} onChange={(e) => saveSettings({ model: e.target.value })}>
            {(status?.models ?? [{ id: settings.model, label: settings.model, note: "" }]).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} {m.note ? `— ${m.note}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Reasoning effort</span>
          <select value={settings.effort} onChange={(e) => saveSettings({ effort: e.target.value as Settings["effort"] })}>
            <option value="low">Low — fastest</option>
            <option value="medium">Medium — balanced</option>
            <option value="high">High — most thorough</option>
          </select>
        </label>
        <label className="field">
          <span>Response style</span>
          <select value={settings.responseStyle} onChange={(e) => saveSettings({ responseStyle: e.target.value as Settings["responseStyle"] })}>
            <option value="concise">Concise</option>
            <option value="balanced">Balanced</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
        <Toggle checked={settings.webSearch} onChange={(v) => saveSettings({ webSearch: v })} label="Web search" hint="Let JARVIS search the web for current information, with source links." />
        <CustomInstructions />
        {status?.ai === "demo" && (
          <p className="notice">
            <strong>Demo mode:</strong> the server has no <code>ANTHROPIC_API_KEY</code>, so replies are scripted. Add the key to the server's
            <code>.env</code> file and restart to enable real AI.
          </p>
        )}
      </Card>

      <VoiceSettings />

      <Card title="Appearance & feel" icon="sidebar">
        <div className="segmented wide" role="radiogroup" aria-label="Theme">
          {(["dark", "light", "system"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={settings.theme === t} className={settings.theme === t ? "on" : ""} onClick={() => saveSettings({ theme: t })}>
              {t === "system" ? "Auto" : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <Toggle
          checked={settings.haptics}
          onChange={(v) => {
            saveSettings({ haptics: v });
            if (v) haptic("success");
          }}
          label="Haptic feedback"
          hint="Supported on iOS 18+ and Android."
        />
      </Card>

      <MemorySettings />
      <NotificationSettings />
      <IntegrationSettings />

      <Card title="Privacy & data" icon="download">
        <p className="small muted">Your data is stored on your JARVIS server and is only visible to your account. AI requests are sent to Anthropic to generate replies.</p>
        <div className="button-grid">
          <button type="button" className="btn" onClick={() => download("/api/export/all.json")}>
            <Icon name="download" size={18} /> Export all data (JSON)
          </button>
          <button type="button" className="btn" onClick={() => download("/api/export/notes.md")}>
            <Icon name="notes" size={18} /> Export notes (Markdown)
          </button>
          <button
            type="button"
            className="btn danger ghost"
            onClick={async () => {
              if (!(await confirm({ title: "Clear all conversations?", body: "Every conversation and message will be permanently deleted. Tasks, notes and memories are kept.", confirmLabel: "Clear history", danger: true })))
                return;
              await api("/conversations", { method: "DELETE" });
              setActiveId(null);
              refreshConversations();
              toast("Conversation history cleared.", "success");
            }}
          >
            <Icon name="trash" size={18} /> Clear conversation history
          </button>
          <button
            type="button"
            className="btn danger ghost"
            onClick={async () => {
              if (!(await confirm({ title: "Delete your account?", body: "This permanently deletes your account and all data on this server. This cannot be undone.", confirmLabel: "Delete account", danger: true })))
                return;
              await api("/account", { method: "DELETE" });
              setUser(null);
            }}
          >
            <Icon name="trash" size={18} /> Delete account
          </button>
        </div>
      </Card>

      <Card title="Account" icon="logout">
        <PasswordForm />
        <button
          type="button"
          className="btn block"
          onClick={async () => {
            await api("/auth/logout", { method: "POST" }).catch(() => {});
            await caches?.delete?.("jarvis-api").catch(() => {});
            setUser(null);
          }}
        >
          <Icon name="logout" size={18} /> Sign out
        </button>
      </Card>

      <p className="small muted center">
        JARVIS AI · {status?.ai === "anthropic" ? "Connected to Claude" : "Demo mode"} · {isStandalone() ? "Installed app" : "Browser"}
      </p>
    </section>
  );
}

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="card glass">
      <h2 className="card-title">
        <Icon name={icon} size={18} /> {title}
      </h2>
      {children}
    </div>
  );
}

function ProfileForm() {
  const { user, setUser, settings, saveSettings, toast } = useApp();
  const [name, setName] = useState(user.name);
  const [addressAs, setAddressAs] = useState(settings.addressAs);
  useEffect(() => setAddressAs(settings.addressAs), [settings.addressAs]);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          if (name.trim() && name !== user.name) {
            const r = await api("/auth/profile", { method: "PATCH", body: { name } });
            setUser(r.user);
          }
          if (addressAs !== settings.addressAs) await saveSettings({ addressAs });
          toast("Profile saved.", "success");
        } catch (err) {
          toast((err as Error).message, "error");
        }
      }}
    >
      <div className="form-2col">
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <label>
          JARVIS calls you
          <input value={addressAs} onChange={(e) => setAddressAs(e.target.value)} placeholder="e.g. Sir, Boss, Alex" maxLength={40} />
        </label>
      </div>
      <p className="small muted">Timezone: {settings.timezone} (from this device)</p>
      <button type="submit" className="btn">
        Save profile
      </button>
    </form>
  );
}

function CustomInstructions() {
  const { settings, saveSettings, toast } = useApp();
  const [text, setText] = useState(settings.customInstructions);
  useEffect(() => setText(settings.customInstructions), [settings.customInstructions]);
  const dirty = text !== settings.customInstructions;
  return (
    <div className="form">
      <label>
        Custom instructions
        <textarea
          rows={4}
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. I work in finance. Use metric units and my local currency. Keep answers practical."
        />
      </label>
      {dirty && (
        <button
          type="button"
          className="btn small primary"
          onClick={async () => {
            await saveSettings({ customInstructions: text });
            toast("Instructions saved.", "success");
          }}
        >
          Save instructions
        </button>
      )}
    </div>
  );
}

function VoiceSettings() {
  const { settings, saveSettings } = useApp();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(listVoices());
  useEffect(() => onVoicesChanged(() => setVoices(listVoices())), []);
  const fallback = defaultVoice(voices);
  const lang = navigator.language.slice(0, 2);
  const relevant = voices.filter((v) => v.lang.startsWith("en") || v.lang.startsWith(lang));

  return (
    <div className="card glass">
      <h2 className="card-title">
        <Icon name="mic" size={18} /> Voice
      </h2>
      <p className="small muted">
        Voice input: {sttSupported() ? "available" : "not supported in this browser — use the keyboard's dictation key"} · Voice output: {ttsSupported() ? "available" : "not supported"}
      </p>
      <Toggle checked={settings.textOnly} onChange={(v) => saveSettings({ textOnly: v })} label="Text-only mode" hint="Silences JARVIS and hides voice controls for quiet places." />
      <Toggle
        checked={settings.autoSpeak}
        onChange={(v) => saveSettings({ autoSpeak: v })}
        label="Speak every response"
        hint="Replies to voice questions are always spoken unless text-only mode is on."
      />
      <label className="field">
        <span>Voice</span>
        <select value={settings.voiceURI} onChange={(e) => saveSettings({ voiceURI: e.target.value })} disabled={!ttsSupported()}>
          <option value="">Automatic{fallback ? ` (${fallback.name})` : ""}</option>
          {relevant.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} — {v.lang}
            </option>
          ))}
        </select>
      </label>
      <p className="small muted">Tip: on iPhone/iPad, download higher-quality voices in Settings › Accessibility › Spoken Content › Voices.</p>
      <div className="form-2col">
        <label className="field">
          <span>Speed {settings.speechRate.toFixed(1)}×</span>
          <input type="range" min={0.5} max={2} step={0.1} value={settings.speechRate} onChange={(e) => saveSettings({ speechRate: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Pitch {settings.speechPitch.toFixed(1)}</span>
          <input type="range" min={0.5} max={2} step={0.1} value={settings.speechPitch} onChange={(e) => saveSettings({ speechPitch: Number(e.target.value) })} />
        </label>
      </div>
      <button
        type="button"
        className="btn"
        disabled={!ttsSupported()}
        onClick={() => {
          unlockSpeech();
          speaker.speakAll("Good day. All JARVIS systems are online and at your service.");
        }}
      >
        <Icon name="volume" size={18} /> Test voice
      </button>
      <details className="permissions">
        <summary>Microphone permissions on iPhone & iPad</summary>
        <ul className="small">
          <li>The first time you tap the microphone, iOS asks to allow microphone and speech-recognition access. Tap Allow.</li>
          <li>If you denied it: Settings › Apps › Safari › Microphone (or Settings › Privacy & Security › Microphone), then reload JARVIS.</li>
          <li>Speech recognition uses Apple's dictation service; make sure Siri & Dictation are enabled.</li>
          <li>JARVIS only listens while the microphone button is active. There is no background listening or wake word while the app is closed.</li>
        </ul>
      </details>
    </div>
  );
}

function MemorySettings() {
  const { settings, saveSettings, toast, confirm, bump } = useApp();
  const { data, reload } = useData<{ memories: Memory[] }>("/memories", "memories", { memories: [] });
  const [editing, setEditing] = useState<Partial<Memory> | null>(null);

  const save = async () => {
    if (!editing?.content?.trim()) return;
    try {
      if (editing.id) await api(`/memories/${editing.id}`, { method: "PATCH", body: { content: editing.content, category: editing.category } });
      else await api("/memories", { body: { content: editing.content, category: editing.category ?? "preference" } });
      setEditing(null);
      bump("memories");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="card glass">
      <h2 className="card-title">
        <Icon name="brain" size={18} /> Memory
      </h2>
      <Toggle
        checked={settings.memoryEnabled}
        onChange={(v) => saveSettings({ memoryEnabled: v })}
        label="Personal memory"
        hint="JARVIS may suggest things to remember; nothing is saved without your approval."
      />
      {data.memories.length === 0 ? (
        <p className="small muted">No saved memories.</p>
      ) : (
        <ul className="memory-list">
          {data.memories.map((m) => (
            <li key={m.id}>
              <span className="chip">{m.category}</span>
              <span className="memory-text">{m.content}</span>
              <button type="button" className="icon-btn small" aria-label="Edit memory" onClick={() => setEditing(m)}>
                <Icon name="edit" size={16} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                aria-label="Delete memory"
                onClick={async () => {
                  await api(`/memories/${m.id}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
                  reload();
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button type="button" className="btn" onClick={() => setEditing({ content: "", category: "preference" })}>
          <Icon name="plus" size={18} /> Add memory
        </button>
        {data.memories.length > 0 && (
          <button
            type="button"
            className="btn danger ghost"
            onClick={async () => {
              if (await confirm({ title: "Forget everything?", body: "All saved memories will be deleted.", confirmLabel: "Delete all", danger: true })) {
                await api("/memories", { method: "DELETE" });
                reload();
              }
            }}
          >
            Delete all
          </button>
        )}
      </div>
      {editing && (
        <Sheet title={editing.id ? "Edit memory" : "Add memory"} onClose={() => setEditing(null)}>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label>
              What should JARVIS remember?
              <textarea rows={3} maxLength={500} value={editing.content ?? ""} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
            </label>
            <label>
              Category
              <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                <option value="preference">Preference</option>
                <option value="fact">Fact about me</option>
                <option value="instruction">Instruction</option>
                <option value="tool">Favourite tool</option>
              </select>
            </label>
            <button type="submit" className="btn primary">
              Save
            </button>
          </form>
        </Sheet>
      )}
    </div>
  );
}

function NotificationSettings() {
  const { status, toast } = useApp();
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const unsupported = pushSupportMessage();
  useEffect(() => {
    hasPushSubscription().then(setSubscribed);
  }, []);

  return (
    <div className="card glass">
      <h2 className="card-title">
        <Icon name="bell" size={18} /> Notifications
      </h2>
      <p className="small muted">Reminders when tasks are due and 10 minutes before events.</p>
      {unsupported ? (
        <p className="notice">{unsupported}</p>
      ) : (
        <div className="row">
          {subscribed ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={async () => {
                  const r = await api<{ delivered: number }>("/push/test", { method: "POST" }).catch((e) => (toast(e.message, "error"), null));
                  if (r) toast(r.delivered ? "Test notification sent." : "No devices received it.");
                }}
              >
                Send test
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={async () => {
                  await disablePush();
                  setSubscribed(false);
                }}
              >
                Turn off on this device
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn primary"
              disabled={busy || !status?.vapidPublicKey}
              onClick={async () => {
                setBusy(true);
                try {
                  await enablePush(status!.vapidPublicKey);
                  setSubscribed(true);
                  toast("Notifications enabled.", "success");
                } catch (e) {
                  toast((e as Error).message, "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="bell" size={18} /> Enable notifications
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function IntegrationSettings() {
  const { toast, confirm } = useApp();
  const [feed, setFeed] = useState<string | null>(null);
  const { data: tokens, reload } = useData<{ tokens: { id: number; label: string; created_at: number }[] }>("/tokens", null, { tokens: [] });
  const [newToken, setNewToken] = useState<string | null>(null);

  useEffect(() => {
    api<{ path: string }>("/calendar/feed").then((r) => setFeed(r.path)).catch(() => {});
  }, []);

  const httpsUrl = feed ? `${location.origin}${feed}` : "";
  const webcal = httpsUrl.replace(/^https?:/, "webcal:");

  return (
    <div className="card glass">
      <h2 className="card-title">
        <Icon name="link" size={18} /> Apple integrations
      </h2>

      <h3 className="sub-title">Apple Calendar</h3>
      <p className="small muted">Subscribe once and your JARVIS events and dated tasks appear in Apple Calendar (read-only, refreshes periodically). The server must be reachable from your device.</p>
      {feed && (
        <>
          <div className="row">
            <a className="btn primary" href={webcal}>
              <Icon name="calendar" size={18} /> Subscribe in Calendar
            </a>
            <button type="button" className="btn ghost" onClick={() => navigator.clipboard?.writeText(httpsUrl).then(() => toast("Feed URL copied."))}>
              <Icon name="copy" size={18} /> Copy URL
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                if (!(await confirm({ title: "Reset calendar link?", body: "Existing subscriptions will stop updating. You'll need to subscribe again.", confirmLabel: "Reset" }))) return;
                const r = await api<{ path: string }>("/calendar/feed/rotate", { method: "POST" });
                setFeed(r.path);
              }}
            >
              Reset link
            </button>
          </div>
          <p className="small muted">Keep this link private — anyone with it can read your calendar.</p>
        </>
      )}

      <h3 className="sub-title">Siri & Shortcuts</h3>
      <p className="small muted">
        Create an access token, then build Shortcuts that call JARVIS — for example “Ask JARVIS” (Dictate Text → Get Contents of URL → Speak Text), a Share Sheet action, or
        “Add to JARVIS”. Step-by-step recipes are in the project README (docs/IOS.md).
      </p>
      <ul className="small mono-list">
        <li>POST {location.origin}/api/shortcuts/ask — body {"{ text }"} → spoken answer</li>
        <li>POST {location.origin}/api/shortcuts/task — body {"{ text }"} → adds a task/event</li>
        <li>GET {location.origin}/api/shortcuts/agenda → today's agenda</li>
        <li>Open {location.origin}/?q=… to send text into JARVIS</li>
      </ul>
      {tokens.tokens.length > 0 && (
        <ul className="token-list">
          {tokens.tokens.map((t) => (
            <li key={t.id}>
              <span>
                {t.label} <small className="muted">· created {new Date(t.created_at).toLocaleDateString()}</small>
              </span>
              <button
                type="button"
                className="btn small danger ghost"
                onClick={async () => {
                  await api(`/tokens/${t.id}`, { method: "DELETE" });
                  reload();
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn"
        onClick={async () => {
          const r = await api<{ token: string }>("/tokens", { body: { label: isIOS() ? "iOS Shortcuts" : "Shortcuts" } });
          setNewToken(r.token);
          reload();
        }}
      >
        <Icon name="plus" size={18} /> Create access token
      </button>
      {newToken && (
        <Sheet title="Your access token" onClose={() => setNewToken(null)}>
          <p className="small muted">Copy it now — it won't be shown again. In Shortcuts, add a header “Authorization” with the value “Bearer &lt;token&gt;”.</p>
          <code className="token-box">{newToken}</code>
          <button type="button" className="btn primary" onClick={() => navigator.clipboard?.writeText(newToken).then(() => toast("Token copied."))}>
            <Icon name="copy" size={18} /> Copy token
          </button>
        </Sheet>
      )}
    </div>
  );
}

function PasswordForm() {
  const { toast } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/auth/password", { body: { current, next } });
          setCurrent("");
          setNext("");
          toast("Password changed. Other devices were signed out.", "success");
        } catch (err) {
          toast((err as Error).message, "error");
        }
      }}
    >
      <div className="form-2col">
        <label>
          Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label>
          New password
          <input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="btn" disabled={!current || next.length < 8}>
        Change password
      </button>
    </form>
  );
}
