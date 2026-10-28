// End-to-end test of the free on-device edition with a mocked Gemini API.
// Usage: BASE_PATH=/Jarvis-/ npm run build:standalone && (cd web && BASE_PATH=/Jarvis-/ npx vite preview --port 4173) & npm run e2e:standalone
const { chromium, devices } = require("playwright");
const assert = require("node:assert");
(async () => {
  const B = process.env.JARVIS_URL ?? "http://localhost:4173/Jarvis-/";
  const out = (process.env.SHOTS_DIR ?? "e2e-screenshots") + "/";
  require("node:fs").mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"], colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  const streamBodies = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

  const sse = (objs) => objs.map((o) => `data: ${JSON.stringify(o)}\r\n\r\n`).join("");
  await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const req = route.request();
    const url = req.url();
    assert.equal(req.headers()["x-goog-api-key"], "AIzaTESTKEY");
    if (url.includes("/models?")) {
      return route.fulfill({ json: { models: [
        { name: "models/gemini-flash-latest", displayName: "Gemini Flash Latest", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-pro-latest", displayName: "Gemini Pro Latest", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
      ] } });
    }
    const body = JSON.parse(req.postData());
    if (url.includes(":streamGenerateContent")) {
      streamBodies.push(body);
      const last = body.contents.at(-1);
      if (last.parts.some((p) => p.functionResponse)) {
        return route.fulfill({ contentType: "text/event-stream", body: sse([
          { candidates: [{ content: { role: "model", parts: [{ text: "Done. I've added " }] } }] },
          { candidates: [{ content: { role: "model", parts: [{ text: "**Buy milk** to your tasks." }] }, finishReason: "STOP" }] },
        ]) });
      }
      const text = last.parts.map((p) => p.text || "").join(" ");
      if (/milk/i.test(text)) {
        return route.fulfill({ contentType: "text/event-stream", body: sse([
          { candidates: [{ content: { role: "model", parts: [{ text: "Certainly." }] } }] },
          { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "create_task", args: { title: "Buy milk", priority: "high", due_at: "2026-10-29T17:00:00+03:00", notes: null } }, thoughtSignature: "SIG123" }] }, finishReason: "STOP" }] },
        ]) });
      }
      return route.fulfill({ contentType: "text/event-stream", body: sse([
        { candidates: [{ content: { role: "model", parts: [{ text: "Good afternoon. " }] } }] },
        { candidates: [{ content: { role: "model", parts: [{ text: "Cloud computing means renting computers over the internet.\n\n```js\nconsole.log('hi')\n```" }] }, finishReason: "STOP" }] },
      ]) });
    }
    if (url.includes(":generateContent")) {
      if (body.generationConfig?.responseSchema) {
        return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ kind: "task", title: "Call the bank", priority: "high", due_or_start: "2026-10-29T10:00:00", end: null, location: null, notes: null }) }] }, finishReason: "STOP" }] } });
      }
      return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "- Arc reactor v2\n- Telemetry dashboard" }] }, finishReason: "STOP" }] } });
    }
    return route.fulfill({ status: 404, json: { error: { message: "unexpected" } } });
  });

  await page.goto(B);
  await page.waitForSelector("text=Gemini API key");
  await page.getByLabel("Your name").fill("Tony");
  await page.getByLabel("Gemini API key (free)").fill("AIzaTESTKEY");
  await page.screenshot({ path: out + "01-setup.png" });
  await page.getByRole("button", { name: "Bring JARVIS online" }).click();
  await page.waitForSelector(".hero");
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + "02-home.png" });

  // Plain question
  await page.getByLabel("Message JARVIS").fill("Explain cloud computing");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForSelector(".code-block");
  // Tool round trip
  await page.getByLabel("Message JARVIS").fill("Remind me to buy milk tomorrow 5pm, important");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForSelector("text=Task added: Buy milk");
  await page.waitForSelector("text=to your tasks.");
  await page.screenshot({ path: out + "03-chat.png" });

  const second = streamBodies[1];
  assert.ok(second.systemInstruction.parts[0].text.includes("You are JARVIS"));
  assert.ok(second.tools[0].functionDeclarations.some((f) => f.name === "create_task"));
  assert.ok(second.tools[0].functionDeclarations.some((f) => f.name === "web_search"));
  assert.equal(second.contents[0].role, "user");
  assert.ok(second.contents.at(-1).parts[0].text.startsWith("<context>Current local time"));
  const third = streamBodies[2];
  const modelTurn = third.contents.at(-2);
  assert.equal(modelTurn.role, "model");
  assert.ok(modelTurn.parts.some((p) => p.functionCall && p.thoughtSignature === "SIG123"), "thought signature replayed");
  const fr = third.contents.at(-1).parts[0].functionResponse;
  assert.equal(fr.name, "create_task");
  assert.equal(fr.response.created.title, "Buy milk");
  // roles alternate
  for (let i = 1; i < third.contents.length; i++) assert.notEqual(third.contents[i].role, third.contents[i - 1].role);

  // Tasks + NL quick add
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.waitForSelector("text=Buy milk");
  await page.getByLabel("Add a task in natural language").fill("call the bank tomorrow 10am urgent");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForSelector(".task-title >> text=Call the bank");
  await page.screenshot({ path: out + "04-tasks.png" });

  // Notes + summarise
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Note body").fill("Project ideas: arc reactor v2, telemetry dashboard");
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Summarise" }).click();
  await page.waitForSelector(".summary >> text=Arc reactor v2");

  // Settings
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForSelector("text=Your devices");
  await page.waitForSelector("text=Gemini Pro Latest", { state: "attached" });
  await page.screenshot({ path: out + "05-settings.png", fullPage: true });

  // Data persists across reload
  await page.reload();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.waitForSelector("text=Buy milk");
  await page.getByRole("button", { name: "JARVIS", exact: true }).click();
  await page.getByRole("button", { name: "Conversation history" }).click();
  await page.waitForSelector("text=Explain cloud computing");

  // Invalid key error path
  await page.unroute("https://generativelanguage.googleapis.com/**");
  await page.route("https://generativelanguage.googleapis.com/**", (r) => r.fulfill({ status: 429, json: { error: { code: 429, message: "quota", status: "RESOURCE_EXHAUSTED" } } }));
  await page.keyboard.press("Escape");
  await page.getByLabel("Message JARVIS").fill("hello again");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForSelector("text=free-tier limit");

  console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "standalone e2e passed");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
