import { useState } from "react";
import { Orb } from "../components/Orb";
import { api } from "../lib/api";
import type { User } from "../lib/types";

/** First-run setup for the free on-device edition: a name and a Gemini API key. */
export function SetupView({ onSignedIn }: { onSignedIn(u: User): void }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: User }>("/auth/register", { body: { name, key } });
      onSignedIn(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-card glass">
        <Orb state={busy ? "thinking" : "idle"} size={150} />
        <h1 className="brand-word">J.A.R.V.I.S.</h1>
        <p className="muted">Initialise your personal assistant.</p>
        <form className="form" onSubmit={submit}>
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required maxLength={60} />
          </label>
          <label>
            Gemini API key (free)
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="AIza…"
              required
            />
          </label>
          <ol className="setup-steps small muted">
            <li>
              Open{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                aistudio.google.com/apikey
              </a>{" "}
              and sign in with a Google account.
            </li>
            <li>Tap “Create API key”, copy it, and paste it above. No card needed.</li>
          </ol>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn primary block" disabled={busy}>
            {busy ? "Verifying…" : "Bring JARVIS online"}
          </button>
        </form>
        <p className="small muted">
          Your chats, tasks and notes stay on this device. Messages are sent to Google Gemini to generate replies; on the free tier Google may use them to
          improve its products, so avoid sharing sensitive information.
        </p>
      </div>
    </main>
  );
}
