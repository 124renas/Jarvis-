# JARVIS for free — iPhone/iPad only, no computer

The free edition runs entirely in Safari: the app is hosted free on GitHub Pages, the AI is Google Gemini's free tier, and your data is stored on your device. Setup takes about 10 minutes.

## 1. Turn on GitHub Pages (one time)

1. In Safari open **github.com/124renas/Jarvis-** and sign in.
2. Tap **Settings** (on a phone: the ⋯ menu or scroll the repo tabs) → **Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Open the **Actions** tab → **Deploy JARVIS to GitHub Pages** → **Run workflow** (or wait for the next push). After 1–2 minutes it shows a green tick.

Your app is now live at **https://124renas.github.io/Jarvis-/**

> If the deploy step says the branch isn't allowed: Settings → Environments → **github-pages** → Deployment branches → add `claude/jarvis-ai-assistant-ei8nxe` (or merge to `main`).

## 2. Get a free Gemini API key

1. Open **aistudio.google.com/apikey** and sign in with any Google account.
2. Tap **Create API key** and copy it (starts with `AIza`). No payment card is needed for the free tier.

## 3. Install JARVIS

1. Open **https://124renas.github.io/Jarvis-/** in Safari.
2. Enter your name and paste the key → **Bring JARVIS online**.
3. **Share → Add to Home Screen → Add**, then open JARVIS from the icon.
4. Tap the mic and **Allow** microphone and speech recognition.

Do the same on your iPad. To copy your data across: Settings › **Your devices** › Export backup on one device, then Import backup on the other.

## What's included vs. the server edition

| Feature | Free edition | Server edition |
|---|---|---|
| AI chat, streaming, Markdown, attachments | ✅ Gemini | ✅ Claude |
| Voice in/out, orb, iPhone & iPad layouts, offline shell | ✅ | ✅ |
| JARVIS creates tasks, events, notes; memory | ✅ | ✅ |
| Web search with source links | ✅ (Google Search) | ✅ |
| Tasks, calendar, notes, AI summaries, NL quick add | ✅ | ✅ |
| Add events/tasks to Apple Calendar (.ics) | ✅ | ✅ |
| Sync between iPhone and iPad | Manual export/import | Automatic |
| Push reminders when the app is closed | ❌ (use Apple Calendar alerts) | ✅ |
| Apple Calendar subscription feed, Siri Shortcuts API | ❌ | ✅ |

## Limits & privacy

- Gemini's free tier has per-minute and per-day limits. If you hit one, JARVIS tells you; wait a minute or switch model in Settings › Intelligence.
- On the free tier Google may use prompts to improve its products — don't share sensitive personal or financial data.
- Your API key and data stay in Safari's storage on that device. Deleting the Home Screen app or clearing Safari website data erases them, so export a backup occasionally.

## Troubleshooting

| Problem | Fix |
|---|---|
| “API key isn't valid” | Re-copy the key from AI Studio; update it in Settings › Intelligence |
| “model isn't available” | Settings › Intelligence › pick another Gemini model |
| Page shows 404 | Pages not enabled yet, or the workflow hasn't finished (step 1) |
| Mic doesn't work | Settings › Apps › Safari › Microphone → Allow; Siri & Dictation must be on |
