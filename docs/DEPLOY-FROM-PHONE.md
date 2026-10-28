# Set up JARVIS using only an iPhone or iPad

No computer needed. Everything below happens in Safari. Expect about 20 minutes.

You'll need: your GitHub account (already connected), a payment card, and an email address.

## Step 1 — Get a Claude API key (the "brain")

1. In Safari open **platform.claude.com** and sign up.
2. Open **Billing** and add credit (start with $5–10). Usage is pay-as-you-go; a typical question costs a few cents with the default model, less with Sonnet or Haiku (switchable in JARVIS › Settings).
3. Open **API Keys → Create Key**, name it `jarvis`, and **copy** it (starts with `sk-ant-`). Keep it private. You'll paste it in Step 3.

## Step 2 — Host JARVIS on Railway

1. Open **railway.com** and tap **Login → GitHub**.
2. Tap **New Project → Deploy from GitHub repo**. If asked, allow Railway to access the **Jarvis-** repository.
3. Pick **124renas/Jarvis-**. Railway finds the `Dockerfile` and starts building (3–5 minutes).
   - If the repo's default branch isn't the JARVIS branch, open the service › **Settings › Source › Branch** and choose `claude/jarvis-ai-assistant-ei8nxe` (or `main` once merged).

## Step 3 — Add your API key

Open the service › **Variables › New Variable**:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your `sk-ant-…` key |

Save. Railway redeploys automatically.

## Step 4 — Keep your data (important)

Without this, your account, chats and notes are erased on every redeploy.

1. In the project canvas tap **+ (Create) → Volume** (or right-click/long-press the service › **Attach volume**).
2. Attach it to the JARVIS service with mount path **`/data`**.

## Step 5 — Get your web address

Service › **Settings › Networking › Generate Domain**. You'll get something like `https://jarvis-production.up.railway.app`.

Open it: you should see the JARVIS sign-up screen. Create your account straight away — only the first account can register.

## Step 6 — Install on your iPhone / iPad

1. Open your Railway address in **Safari** and sign in.
2. **Share → Add to Home Screen → Add.**
3. Open JARVIS from the Home Screen, tap the mic and **Allow** microphone and speech recognition.
4. In JARVIS › Settings: **Enable notifications**, **Subscribe in Calendar**, choose a voice (e.g. Daniel, English UK).
5. Repeat steps 1–3 on the iPad using the same account.

## Costs

- **Railway**: free trial credit, then the Hobby plan (about $5/month, includes $5 of usage — JARVIS normally fits within it).
- **Claude API**: pay for what you use.

## Troubleshooting

| What you see | Fix |
|---|---|
| "JARVIS systems are online in demo mode" | `ANTHROPIC_API_KEY` missing or misspelled in Railway Variables |
| "The AI service rejected the server's credentials" | Key copied incorrectly or revoked — create a new one |
| Account/chats disappeared after an update | Volume not attached at `/data` (Step 4) |
| "Sign-ups are closed" | An account already exists. To allow more, add variable `ALLOW_SIGNUP=1` |
| Build failed | Railway › Deployments › View logs, and share the error |

More iPhone/iPad tips (permissions, Siri Shortcuts, Calendar): [IOS.md](IOS.md).
