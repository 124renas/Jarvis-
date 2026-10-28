# Architecture

```
iPhone / iPad (PWA)                       JARVIS server (Node 22, Express)            Anthropic
┌──────────────────────────┐   HTTPS     ┌──────────────────────────────────┐         ┌────────┐
│ React UI · Orb (canvas)  │──JSON/SSE──▶│ auth (scrypt, HTTP-only cookies) │         │ Claude │
│ Voice: SpeechRecognition │             │ chat loop ── tools ── SQLite     │──API───▶│  API   │
│        speechSynthesis   │◀──push──────│ web-push scheduler               │         └────────┘
│ Service worker (offline, │             │ ICS feed · Shortcuts endpoints   │
│ push, cached reads)      │             └──────────────────────────────────┘
└──────────────────────────┘
```

## Why a PWA

Native iOS development needs Xcode and an Apple developer account; a PWA installs straight from Safari, works on iPhone and iPad, supports microphone, speech, push notifications (16.4+), offline caching and full-screen mode. The trade-offs (no EventKit, widgets or App Intents) are bridged with the ICS subscription feed and Shortcuts endpoints, and the API is ready for a native shell later.

## Chat pipeline (`server/src/ai/chat.ts`)

1. The user message is stored with a small `<context>` block (local time + timezone) that is replayed byte-identically on later turns, keeping the request prefix stable for prompt caching.
2. History (last 120 messages) + system prompt + per-user profile (custom instructions, approved memories) are sent to Claude via `client.beta.messages.stream` with:
   - model from settings (default `claude-opus-5-5`), adaptive thinking (model default) with `output_config.effort`
   - top-level `cache_control` (automatic prompt caching)
   - `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) so a safety-classifier refusal is retried server-side on the recommended model; refusals that remain are shown politely
   - client tools (`strict: true`): `create_task`, `list_tasks`, `complete_task`, `create_event`, `list_events`, `create_note`, `search_notes`, `propose_memory`; plus the server-side `web_search_20260209` tool when enabled
3. Text deltas stream to the browser as Server-Sent Events. Tool calls are validated with Zod, executed against the user's own rows, and the loop continues (max 8 rounds, `pause_turn` handled).
4. Sources from web-search results/citations are collected and returned as clickable links.
5. Stopping (client abort) saves the partial answer marked "Stopped".

`propose_memory` never writes: it sends a `memory_proposal` event and the user approves it in the UI.

## Security & privacy

- API key only in server env; browser never talks to Anthropic directly.
- Passwords: scrypt with per-user salt. Sessions: random 256-bit tokens stored as SHA-256 hashes; HTTP-only, SameSite=Lax cookies; Shortcuts use revocable bearer tokens.
- Every query is filtered by `user_id` (tested). Cross-origin cookie POSTs are rejected.
- Rate limits on auth and AI endpoints; request validation with Zod.
- Markdown is sanitised with DOMPurify; links open with `noopener`.
- Calendar feed protected by a rotatable secret token.
- Users can export all data, clear history, delete memories, or delete their account.

## Offline & resilience

- Service worker: network-first navigation with cached shell, cache-first hashed assets, network-first cached GETs for conversations/tasks/events/notes/settings. Chat/auth/feeds are never cached; the cache is cleared on sign-out.
- Friendly errors for auth, rate-limit, overload, network and refusal cases; retry buttons on failed replies and lists.
- Demo provider when no key is configured, clearly labelled.

## Extending

| Feature | Where it plugs in |
|---|---|
| Live voice conversation mode | `web/src/lib/voice.ts`: loop `startListening → send → speak → startListening`; the Speaker already streams sentence by sentence |
| Wake word | Needs a native shell (on-device keyword spotting); call the same `/api/chat` |
| Image/document understanding | Already supported in chat (images + PDFs). Larger files: Files API upload in `routes/chat.ts` |
| Personal knowledge search | Add a `search_knowledge` tool in `ai/tools.ts` over notes + uploaded docs (SQLite FTS5 or embeddings) |
| Smart home | Add tools that call Home Assistant's REST API with a server-side token, with confirmation for actions |
| Weather on the dashboard | Client-side Open-Meteo call (no key) with geolocation permission, shown as a card in the hero |
| Widgets / EventKit / App Intents | Native wrapper (Capacitor or SwiftUI) using `/api/shortcuts/*` and bearer tokens |
| Multiple AI providers | Implement `AiProvider` in `ai/provider.ts` |
