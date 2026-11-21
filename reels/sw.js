// Offline cache for the studio. Bump VERSION whenever the list of cached files changes.
const VERSION = "reels-v3";
const SHELL = ["./", "index.html", "style.css?v=3", "studio.js?v=3", "lines.json", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
// Network first, and always ask the server whether our own files changed (GitHub Pages lets
// browsers reuse files for 10 minutes otherwise, which can mix old code with new data).
// Fall back to the cache when offline; fonts are cached on first use.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const own = new URL(e.request.url).origin === self.location.origin;
  const req = own ? new Request(e.request, { cache: "no-cache" }) : e.request;
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
});
