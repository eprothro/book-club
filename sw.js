// Bump CACHE on every deploy that changes a file below.
const CACHE = "bookclub-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/css/app.css",
  "/js/config.js",
  "/js/api.js",
  "/js/app.js",
  "/js/covers.js",
  "/js/drawn.js",
  "/js/spinner.js",
  "/js/wheel.js",
  "/fonts/fraunces.woff2",
  "/fonts/fraunces-italic.woff2",
  "/fonts/outfit.woff2",
  "/favicon.svg",
  "/favicon-32.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Skip the HTTP cache (Pages serves max-age=600), so a new version never
      // installs with the previous deploy's files.
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Network first, so a deploy can't come down as a mix of old and new files;
// the cache is only for a dropped connection. Supabase, covers, and search
// are other origins and never pass through here.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("/index.html");
        return new Response("", { status: 504, statusText: "Offline" });
      }),
  );
});
