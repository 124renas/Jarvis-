# JARVIS on iPhone & iPad

JARVIS is a Progressive Web App. Installed to the Home Screen it runs full-screen like a native app. This guide covers installation, permissions, and every Apple integration that is genuinely possible from a web app — and what isn't.

## 1. Install

1. Make sure the server is reachable over **HTTPS** (see the README: tunnel, VPS or Tailscale).
2. Open the URL in **Safari** (on iOS 16.4+ other browsers can also add to Home Screen, but Safari is most reliable).
3. **Share → Add to Home Screen → Add.**
4. Open JARVIS from the Home Screen icon.

Supported: iOS / iPadOS 16.4 or later recommended (needed for notifications). Layouts adapt automatically:

| Device | Layout |
|---|---|
| iPhone (portrait/landscape) | Compact: tab bar, history sheet |
| iPad portrait / landscape, Split View ≥ 744 pt | Sidebar with navigation + conversations, assistant on the right |
| iPad Slide Over / narrow Split View | Compact layout |

iPad keyboard shortcuts: **⌘K** new conversation, **⌘1–⌘5** switch sections, **Return** sends, **Shift-Return** new line.

## 2. Permissions

| Permission | When it's asked | Why | If you denied it |
|---|---|---|---|
| Microphone | First tap of the mic button | Voice commands | Settings › Apps › Safari › Microphone → Allow (or Settings › Privacy & Security › Microphone), then reopen JARVIS |
| Speech Recognition | First tap of the mic button | Apple transcribes your speech | Settings › Privacy & Security › Speech Recognition; Siri & Dictation must be enabled |
| Notifications | Settings › Notifications › *Enable notifications* (Home Screen app only) | Task-due and event reminders | Settings › Notifications › JARVIS |
| Camera / Photos | Attach button → Take Photo / Photo Library | Image analysis | Handled by the iOS picker; no blanket access is granted |

Facts worth knowing:

- JARVIS listens **only while the mic button is active** and the app is open. There is no background listening and no "Hey JARVIS" wake word when the app is closed — iOS doesn't allow that for web apps. Use the Siri Shortcut below for hands-free launch.
- Speech output uses iOS voices. For a better JARVIS voice download an enhanced/premium English (UK) voice such as *Daniel* or *Arthur*: Settings › Accessibility › Spoken Content › Voices › English, then choose it in JARVIS › Settings › Voice.
- The ring/silent switch can mute spoken replies on iPhone.
- If voice input isn't available, the keyboard's own dictation 🎤 key works in the text field.
- Haptics: iOS Safari has no vibration API; JARVIS uses the iOS 18 system switch haptic where available.

## 3. Apple Calendar

**Subscribe (recommended):** JARVIS › Settings › Apple integrations › **Subscribe in Calendar**. iOS opens a "Subscribe to Calendar" prompt. Your JARVIS events and tasks with due dates then appear in Apple Calendar and refresh periodically (iOS decides the interval; typically every 15 min–1 h). It's read-only on the Apple side — edit in JARVIS.

Manual: Settings › Apps › Calendar › Calendar Accounts › Add Account › Other › **Add Subscribed Calendar**, paste the feed URL (Copy URL in JARVIS).

**Single events:** open an event › **Add to Calendar** downloads an .ics file that iOS offers to add to any calendar (including iCloud/Exchange). Same for tasks with due dates.

The feed URL contains a secret token. Use **Reset link** if it leaks.

## 4. Siri & Shortcuts

First create a token: JARVIS › Settings › Apple integrations › **Create access token**. Copy it (it's shown once). Every Shortcut below uses **Get Contents of URL** with:

- Method: **POST** (or GET for agenda)
- Headers: `Authorization` = `Bearer YOUR_TOKEN`, `Content-Type` = `application/json`
- Request Body: **JSON** with a field `text`

Replace `https://jarvis.example.com` with your URL.

### "Ask JARVIS" (hands-free, works from Siri)

1. Shortcuts › **+** › name it **Ask JARVIS**.
2. **Dictate Text** (Stop Listening: After Pause).
3. **Get Contents of URL** → `https://jarvis.example.com/api/shortcuts/ask`, POST, JSON body `text` = *Dictated Text*.
4. **Speak Text** → *Contents of URL* (choose your voice/rate).
5. Say **"Hey Siri, Ask JARVIS"**. The exchange is also saved as a conversation in the app.

### "Add to JARVIS" (tasks & events by voice)

Same as above but URL `…/api/shortcuts/task`. JARVIS decides whether it's a task or an event and replies e.g. *"Task added: Call the bank, due Thu 29 Oct 10:00."* — finish with **Speak Text** or **Show Notification**.

### "JARVIS agenda"

**Get Contents of URL** (GET) `…/api/shortcuts/agenda` with the Authorization header → **Speak Text**. Great as a morning Automation (Shortcuts › Automation › Time of Day).

### Share Sheet: "Summarise with JARVIS"

1. New Shortcut › ⓘ › enable **Show in Share Sheet**, accept **Text**, **Safari web pages**, **URLs**.
2. **Get Contents of URL** `…/api/shortcuts/ask`, JSON `text` = `Summarise this:` + *Shortcut Input*.
3. **Quick Look** or **Show Result** → *Contents of URL*.

Alternative without a token: **URL** `https://jarvis.example.com/?q=` + *URL-encoded Shortcut Input* → **Open URLs**. This opens JARVIS with the text in the composer (add `&send=1` to send immediately).

### Apple Reminders (optional)

JARVIS can't write to Reminders directly from the web. A Shortcut can: **Get Contents of URL** `GET …/api/tasks` (Authorization header) → **Get Dictionary Value** `tasks` → **Repeat with Each** → **Add New Reminder** with *title* (and *due_at* converted with **Get Dates from Input** after dividing by 1000 if you want due dates). Run it manually or on an automation.

### One-tap launchers

iOS doesn't show web-app long-press menus, so add any of the Shortcuts above to the Home Screen (Shortcut › Share › Add to Home Screen) or to the Lock Screen / Control Center as a Shortcuts widget.

## 5. What a native shell would add

These need a native iOS wrapper (e.g. Capacitor or a SwiftUI app hosting the same backend), and the backend API is already shaped for it:

- EventKit read/write access to Apple Calendar and Reminders
- App Intents / Siri phrases without building Shortcuts manually
- Home Screen and Lock Screen widgets (agenda, quick ask)
- Native share extension
- Background audio session for a continuous "live conversation" mode

See [ARCHITECTURE.md](ARCHITECTURE.md).
