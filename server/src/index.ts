import { config } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { createProvider } from "./ai/provider.js";
import { initPush, startReminderLoop } from "./push.js";

const db = openDb();
const provider = createProvider();
initPush(db);
startReminderLoop(db);

const app = createApp(db, provider);
app.listen(config.port, config.host, () => {
  console.log(`\n  JARVIS server online → http://localhost:${config.port}`);
  console.log(
    provider.name === "demo"
      ? "  AI: DEMO MODE (no ANTHROPIC_API_KEY set) — replies are scripted, not real AI.\n"
      : "  AI: Claude API connected.\n",
  );
});
