// End-to-end walkthrough against a running server with a fresh database (demo mode is fine).
// Usage: JARVIS_URL=http://localhost:8787 npm run e2e   (requires Playwright)
const { chromium, devices } = require("playwright");
(async () => {
  const B = process.env.JARVIS_URL ?? "http://localhost:8787";
  const browser = await chromium.launch();
  const out = (process.env.SHOTS_DIR ?? "e2e-screenshots") + "/";
  require("node:fs").mkdirSync(out, { recursive: true });
  const errors = [];
  // iPhone
  const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"], colorScheme: "dark" });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(B);
  await page.getByLabel("Name").fill("Tony Stark");
  await page.getByLabel("Email").fill("tony@stark.com");
  await page.getByLabel("Password").fill("ironman123");
  await page.screenshot({ path: out + "01-auth.png" });
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForSelector(".hero");
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + "02-iphone-home.png" });
  await page.getByLabel("Message JARVIS").fill("Add task buy groceries for the weekend");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForSelector(".actions-list");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out + "03-iphone-chat.png" });
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByLabel("Add a task in natural language").fill("Call the bank tomorrow at 10am urgent");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + "04-iphone-tasks.png" });
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await page.getByLabel("Add an event in natural language").fill("Lunch with Pepper tomorrow 1pm");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: out + "05-iphone-calendar.png", fullPage: true });
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByLabel("Note body").fill("# Project ideas\n\n- Arc reactor v2\n- Suit telemetry dashboard");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Summarise" }).click();
  await page.waitForSelector(".summary");
  await page.screenshot({ path: out + "06-iphone-note.png" });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: out + "07-iphone-settings.png" });
  const cookies = await ctx.cookies();

  // iPad landscape + portrait, light mode too
  for (const [name, vp, scheme] of [["08-ipad-landscape", { width: 1180, height: 820 }, "dark"], ["09-ipad-portrait", { width: 820, height: 1180 }, "dark"]]) {
    const c2 = await browser.newContext({ ...devices["iPad Pro 11"], viewport: vp, colorScheme: scheme });
    await c2.addCookies(cookies);
    const p2 = await c2.newPage();
    p2.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p2.goto(B);
    await p2.waitForSelector(".sidebar");
    await p2.waitForTimeout(800);
    await p2.screenshot({ path: out + name + "-home.png" });
    await p2.locator(".sidebar .conv-item").first().click();
    await p2.waitForSelector(".msg-assistant");
    await p2.waitForTimeout(500);
    await p2.screenshot({ path: out + name + "-chat.png" });
    await c2.close();
  }
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; } else console.log("E2E passed: no page errors. Screenshots in", out);
  await browser.close();
})();
