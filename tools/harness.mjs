// Shared test setup: a static server for the site, phones with mobile
// viewports, and network routes. Supabase RPCs go to a local Postgres (see
// local-db.mjs). Open Library, covers, and the supabase-js bundle come from
// the network once and are cached under /tmp so reruns are stable.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { rpc } from "./local-db.mjs";

const root = new URL("..", import.meta.url).pathname;
const CACHE = process.env.BOOKCLUB_NET_CACHE || "/tmp/bookclub-net-cache";
fs.mkdirSync(CACHE, { recursive: true });

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};

export function serveSite(port = 8766) {
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (file.endsWith("/")) file += "index.html";
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(full)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

export const PHONES = {
  "iphone-se": {
    viewport: { width: 375, height: 667 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    keyboard: 260,
  },
  "iphone-15": {
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    keyboard: 336,
  },
  pixel: {
    viewport: { width: 412, height: 915 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    keyboard: 320,
  },
  "android-small": {
    viewport: { width: 360, height: 640 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-A136U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    keyboard: 290,
  },
};

async function cached(route, { contentType } = {}) {
  const url = route.request().url();
  const key = crypto.createHash("sha1").update(url).digest("hex");
  const file = path.join(CACHE, key);
  if (fs.existsSync(file)) {
    const meta = JSON.parse(fs.readFileSync(`${file}.json`, "utf8"));
    await route.fulfill({ status: meta.status, headers: meta.headers, body: fs.readFileSync(file) });
    return;
  }
  try {
    const res = await fetch(url, { redirect: "follow" });
    const body = Buffer.from(await res.arrayBuffer());
    const headers = {
      "content-type": contentType || res.headers.get("content-type") || "application/octet-stream",
      "access-control-allow-origin": "*",
    };
    if (res.ok) {
      fs.writeFileSync(file, body);
      fs.writeFileSync(`${file}.json`, JSON.stringify({ status: res.status, headers }));
    }
    await route.fulfill({ status: res.status, headers, body });
  } catch {
    await route.abort();
  }
}

// One phone = one browser context: its own localStorage, so its own token.
export async function phone(browser, pool, name = "iphone-15", opts = {}) {
  const device = PHONES[name];
  const context = await browser.newContext({
    viewport: device.viewport,
    userAgent: device.userAgent,
    deviceScaleFactor: opts.scale ?? 2,
    isMobile: browser.browserType().name() !== "firefox",
    hasTouch: true,
    reducedMotion: opts.reducedMotion || "no-preference",
    ...(opts.recordVideo ? { recordVideo: opts.recordVideo } : {}),
  });
  const calls = [];
  await context.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    const args = route.request().postDataJSON() || {};
    calls.push({ fn, args });
    if (opts.offline) {
      await route.abort("internetdisconnected");
      return;
    }
    try {
      const data = await rpc(pool, fn, args, { ip: opts.ip || "203.0.113.50" });
      await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(data) });
    } catch (error) {
      await route.fulfill({ status: 400, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ message: error.message }) });
    }
  });
  await context.route("https://cdn.jsdelivr.net/**", (route) => cached(route));
  await context.route("https://openlibrary.org/search.json**", async (route) => {
    if (opts.searchDown) return route.abort();
    if (opts.searchDelay) await new Promise((resolve) => setTimeout(resolve, opts.searchDelay));
    const params = new URL(route.request().url()).searchParams;
    const q = params.get("q") || params.get("title") || "";
    if (opts.fixtures?.[q.toLowerCase()]) {
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(opts.fixtures[q.toLowerCase()]) });
    }
    return cached(route, { contentType: "application/json" });
  });
  // Keyless Google Books is usually over quota from CI addresses; answer as it does then.
  await context.route("https://www.googleapis.com/books/**", (route) =>
    route.fulfill({ status: 429, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"error":{"code":429}}' }),
  );
  await context.route("https://covers.openlibrary.org/**", (route) => cached(route, { contentType: "image/jpeg" }));
  await context.route("https://archive.org/**", (route) => cached(route, { contentType: "image/jpeg" }));
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    console.error("pageerror", name, error.message);
    if (!opts.allowErrors) throw error;
  });
  return { context, page, calls, device, name };
}

export async function open(page, base = "http://127.0.0.1:8766/") {
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => document.body.dataset.view !== "loading");
}

export const view = (page) => page.evaluate(() => document.body.dataset.view);
export const pane = (page) => page.evaluate(() => document.body.dataset.pane);

export async function settle(page, ms = 400) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(ms);
}
