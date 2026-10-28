// Renders web/public/icons/icon.svg into the PNG sizes iOS and the manifest need.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
const dir = path.join(__dirname, "..", "web", "public", "icons");
const svg = fs.readFileSync(path.join(dir, "icon.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
const targets = [
  ["apple-touch-icon.png", 180, 0],
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["icon-maskable-512.png", 512, 0.12],
];
for (const [name, size, pad] of targets) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(
    `<body style="margin:0;background:#020617;display:grid;place-items:center;width:${size}px;height:${size}px">` +
      svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `) +
      "</body>",
  );
  await page.screenshot({ path: path.join(dir, name), omitBackground: false });
  console.log("wrote", name);
}
await browser.close();
})();
