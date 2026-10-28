import { useState } from "react";
import { Orb } from "../components/Orb";
import { api } from "../lib/api";
import type { User } from "../lib/types";

export function AuthView({ signupAllowed, onSignedIn }: { signupAllowed: boolean; onSignedIn(u: User): void }) {
  const [mode, setMode] = useState<"login" | "register">(signupAllowed ? "register" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "register"
          ? { name, email, password, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
          : { email, password };
      const { user } = await api<{ user: User }>(`/auth/${mode}`, { body });
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
        <p className="muted">{mode === "register" ? "Initialise your personal assistant." : "Welcome back. Please identify yourself."}</p>
        <form className="form" onSubmit={submit}>
          {mode === "register" && (
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={60} />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required inputMode="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              minLength={mode === "register" ? 8 : 1}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn primary block" disabled={busy}>
            {busy ? "One moment…" : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>
        {signupAllowed ? (
          <button type="button" className="link-btn" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        ) : (
          mode === "login" && <p className="small muted">New sign-ups are closed on this server.</p>
        )}
      </div>
    </main>
  );
}
