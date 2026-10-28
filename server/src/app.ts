import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import type { DB } from "./db.js";
import { config } from "./config.js";
import { requireAuth } from "./auth.js";
import type { AiProvider } from "./ai/provider.js";
import { HttpError } from "./lib/http.js";
import { authRoutes } from "./routes/auth.js";
import { chatRoutes } from "./routes/chat.js";
import { dataRoutes } from "./routes/data.js";
import { assistRoutes } from "./routes/assist.js";
import { feedRoutes, integrationRoutes } from "./routes/integrations.js";

export function createApp(db: DB, provider: AiProvider) {
  const app = express();
  app.disable("x-powered-by");
  // A number means "trust this many proxy hops" (e.g. TRUST_PROXY=1 behind a cloud load balancer).
  const trustProxy = process.env.TRUST_PROXY ?? "loopback";
  app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "microphone=(self), camera=(self), geolocation=(self)");
    next();
  });
  app.use(express.json({ limit: "40mb" }));
  app.use(cookieParser());

  // Cross-site request protection for cookie-authenticated, state-changing calls.
  app.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.headers.authorization) return next();
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) {
      res.status(403).json({ error: "Cross-origin request blocked." });
      return;
    }
    next();
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true, ai: provider.name }));
  app.use("/api/auth", authRoutes(db));
  app.use("/feeds", feedRoutes(db));

  const auth = requireAuth(db);
  app.use("/api", auth, chatRoutes(db, provider));
  app.use("/api", auth, dataRoutes(db));
  app.use("/api/assist", auth, assistRoutes(db, provider));
  app.use("/api", auth, integrationRoutes(db, provider));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

  // Serve the built PWA in production.
  if (fs.existsSync(config.webDist)) {
    app.use(
      express.static(config.webDist, {
        index: false,
        setHeaders: (res, file) => {
          if (file.endsWith("sw.js") || file.endsWith(".webmanifest") || file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
          else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
    app.get(/^(?!\/api|\/feeds).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(config.webDist, "index.html"));
    });
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err?.type === "entity.too.large") {
      res.status(413).json({ error: "That upload is too large." });
      return;
    }
    if (err?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}
