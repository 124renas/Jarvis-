import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(400, `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  return r.data;
}

export function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "Invalid id.");
  return id;
}

export function notFound(what = "Item"): never {
  throw new HttpError(404, `${what} not found.`);
}

/** Fixed-window in-memory rate limiter keyed by user id or IP. */
export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string; message?: string }) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const k = opts.key(req);
    const t = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < t) {
      h = { count: 0, reset: t + opts.windowMs };
      hits.set(k, h);
    }
    if (++h.count > opts.max) {
      res.setHeader("Retry-After", Math.ceil((h.reset - t) / 1000));
      res.status(429).json({ error: opts.message ?? "Too many requests. Please slow down." });
      return;
    }
    if (hits.size > 10_000) for (const [key, v] of hits) if (v.reset < t) hits.delete(key);
    next();
  };
}
