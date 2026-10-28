import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { DB } from "./db.js";
import { now } from "./db.js";
import { config } from "./config.js";

export const SESSION_COOKIE = "jarvis_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 60; // 60 days

export interface AuthUser {
  id: number;
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export function createSession(db: DB, userId: number, kind: "web" | "api" = "web", label?: string): string {
  const token = randomToken();
  const ttl = kind === "api" ? SESSION_TTL_MS * 60 : SESSION_TTL_MS;
  db.prepare("INSERT INTO sessions (token_hash, user_id, kind, label, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    sha256(token),
    userId,
    kind,
    label ?? null,
    now() + ttl,
    now(),
  );
  return token;
}

export function deleteSession(db: DB, token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure || req.secure,
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

function tokenFrom(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return req.cookies?.[SESSION_COOKIE];
}

export function lookupUser(db: DB, token: string | undefined): AuthUser | undefined {
  if (!token) return undefined;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as (AuthUser & { expires_at: number }) | undefined;
  if (!row || row.expires_at < now()) return undefined;
  return { id: row.id, email: row.email, name: row.name };
}

export function requireAuth(db: DB) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = lookupUser(db, tokenFrom(req));
    if (!user) {
      res.status(401).json({ error: "Not signed in." });
      return;
    }
    req.user = user;
    next();
  };
}

export const currentToken = tokenFrom;
