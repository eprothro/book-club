// Renders og.png, apple-touch-icon.png, and favicon-32.png from the real
// wheel and spinner components. Run from the repo root:
//   node tools/render-images.mjs
import { chromium } from "playwright";
import { serveSite } from "./harness.mjs";

const server = await serveSite(8767);
const base = "http://127.0.0.1:8767";
const browser = await chromium.launch();

// Public-domain titles on drawn covers, so the preview carries no cover art.
const og = `<!doctype html><html><head><link rel="stylesheet" href="/css/app.css">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  .og { display: grid; grid-template-columns: 560px 1fr; align-items: center; height: 100%; padding: 0 70px 0 50px; gap: 40px; }
  .og .wheel-host { width: 540px; height: 540px; margin: 0; }
  .og h1 { margin: 0; font: 500 92px/0.98 var(--display); letter-spacing: -0.02em; }
  .og h1 em { color: var(--wine); }
  .og p { margin: 26px 0 0; font: 400 32px/1.3 var(--sans); color: var(--ink-2); }
</style></head><body data-view="og">
<div class="og"><div class="wheel-host" id="w"></div><div><h1>Book <em>Club</em></h1><p>Pick our next book.</p></div></div>
<script type="module">
  import { createWheel } from "/js/wheel.js";
  import { SPINNER } from "/js/config.js";
  const picks = ["Persuasion", "Middlemarch", "Jane Eyre", "Little Women", "Emma", "Dracula"].map((title, i) => ({ id: String(i), title, author: null, cover_url: null }));
  const w = createWheel(document.getElementById("w"), { picks, spinner: SPINNER });
  w.pointAt(1, 4242);
  await document.fonts.ready;
  document.body.dataset.ready = "1";
</script></body></html>`;

const icon = (size) => `<!doctype html><html><head><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:radial-gradient(circle,#fbf6ea 0 56%,#f1e6cf 56% 62%,#7d2e3a 62%)}
.h{position:absolute;inset:0;transform:rotate(-38deg) scale(1.22)}</style></head><body>
<div class="h" id="h"></div>
<script type="module">
  import { spinnerSVG } from "/js/spinner.js";
  import { SPINNER } from "/js/config.js";
  document.getElementById("h").innerHTML = spinnerSVG(SPINNER);
  document.body.dataset.ready = "1";
</script></body></html>`;

async function render(html, path, size) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.route(`${base}/__render`, (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto(`${base}/__render`);
  await page.waitForFunction(() => document.body.dataset.ready === "1");
  await page.waitForTimeout(300);
  await page.screenshot({ path });
  await page.close();
  console.log("wrote", path);
}

await render(og, "og.png", { width: 1200, height: 630 });
await render(icon(180), "apple-touch-icon.png", { width: 180, height: 180 });
await browser.close();

// The 32px icon is the simple book mark; the spinner is unreadable that small.
const small = await chromium.launch();
const page = await small.newPage({ viewport: { width: 32, height: 32 } });
await page.goto(`${base}/index.html`);
await page.setContent(`<html><body style="margin:0"><img src="${base}/favicon.svg" width="32" height="32"></body></html>`);
await page.waitForTimeout(200);
await page.screenshot({ path: "favicon-32.png", omitBackground: true });
console.log("wrote favicon-32.png");
await small.close();
server.close();
