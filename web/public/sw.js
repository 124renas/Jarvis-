// JARVIS service worker: offline app shell, cached reads, and push reminders.
const VERSION = "jarvis-v2";
const SHELL = `${VERSION}-shell`;
const API_CACHE = "jarvis-api";
// Paths are relative to the service worker's scope ("/" for the server edition, "/<repo>/" on GitHub Pages).
const SCOPE = new URL(self.registration.scope).pathname;
const SHELL_URLS = ["", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/apple-touch-icon.png"].map((p) => SCOPE + p);
// Read-only data cached for offline viewing (per device; cleared on sign-out).
const CACHEABLE_API = /^\/api\/(conversations(\/\d+)?|tasks|events|notes|settings|status|memories)(\?.*)?$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // Never cache auth, streaming chat, feeds or exports.
  if (url.pathname.startsWith("/api/")) {
    if (!CACHEABLE_API.test(url.pathname + url.search)) return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ error: "You're offline." }), { status: 503, headers: { "Content-Type": "application/json" } }))),
    );
    return;
  }
  if (url.pathname.startsWith("/feeds/")) return;

  // App navigation: network first, fall back to the cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(SCOPE, copy));
          return res;
        })
        .catch(() => caches.match(SCOPE)),
    );
    return;
  }

  // Static assets: cache first (hashed filenames), then network.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith(SCOPE + "assets/") || url.pathname.startsWith(SCOPE + "icons/"))) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "clear-api-cache") caches.delete(API_CACHE);
});

self.addEventListener("push", (event) => {
  let data = { title: "JARVIS", body: "", url: SCOPE };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: SCOPE + "icons/icon-192.png",
      badge: SCOPE + "icons/icon-192.png",
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || SCOPE, self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(target);
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
