import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db.js";
import { now } from "../db.js";
import {
  createSession,
  currentToken,
  deleteSession,
  hashPassword,
  lookupUser,
  randomToken,
  requireAuth,
  SESSION_COOKIE,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";
import { config } from "../config.js";
import { HttpError, parseBody, rateLimit } from "../lib/http.js";
import { updateSettings } from "../settings.js";

const Credentials = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export function signupAllowed(db: DB): boolean {
  if (config.allowSignup === "1") return true;
  if (config.allowSignup === "0") return false;
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return n === 0;
}

export function authRoutes(db: DB) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, max: 20, key: (req) => `auth:${req.ip}`, message: "Too many sign-in attempts. Try again later." });

  r.get("/session", (req, res) => {
    const user = lookupUser(db, currentToken(req));
    res.json({ user: user ?? null, signupAllowed: signupAllowed(db) });
  });

  r.post("/register", limiter, (req, res) => {
    if (!signupAllowed(db)) throw new HttpError(403, "Sign-ups are closed on this server.");
    const body = parseBody(Credentials.extend({ name: z.string().trim().min(1).max(60) }), req.body);
    const exists = db.prepare("SELECT 1 FROM users WHERE email = ?").get(body.email);
    if (exists) throw new HttpError(409, "An account with that email already exists.");
    const info = db
      .prepare("INSERT INTO users (email, name, password_hash, feed_token, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(body.email, body.name, hashPassword(body.password), randomToken(24), now());
    const userId = Number(info.lastInsertRowid);
    const tz = typeof req.body?.timezone === "string" ? req.body.timezone : undefined;
    if (tz) updateSettings(db, userId, { timezone: tz });
    setSessionCookie(req, res, createSession(db, userId));
    res.status(201).json({ user: { id: userId, email: body.email, name: body.name } });
  });

  r.post("/login", limiter, (req, res) => {
    const body = parseBody(Credentials.extend({ password: z.string().min(1).max(200) }), req.body);
    const row = db.prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?").get(body.email) as
      | { id: number; email: string; name: string; password_hash: string }
      | undefined;
    if (!row || !verifyPassword(body.password, row.password_hash)) throw new HttpError(401, "Incorrect email or password.");
    setSessionCookie(req, res, createSession(db, row.id));
    res.json({ user: { id: row.id, email: row.email, name: row.name } });
  });

  r.post("/logout", (req, res) => {
    const token = currentToken(req);
    if (token) deleteSession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  r.patch("/profile", requireAuth(db), (req, res) => {
    const body = parseBody(z.object({ name: z.string().trim().min(1).max(60) }), req.body);
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(body.name, req.user!.id);
    res.json({ user: { ...req.user!, name: body.name } });
  });

  r.post("/password", requireAuth(db), limiter, (req, res) => {
    const body = parseBody(z.object({ current: z.string(), next: Credentials.shape.password }), req.body);
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user!.id) as { password_hash: string };
    if (!verifyPassword(body.current, row.password_hash)) throw new HttpError(401, "Current password is incorrect.");
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(body.next), req.user!.id);
    // Sign out other web sessions; keep this one and Shortcut tokens.
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND kind = 'web'").run(req.user!.id);
    setSessionCookie(req, res, createSession(db, req.user!.id));
    res.json({ ok: true });
  });

  return r;
}
