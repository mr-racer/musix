import type { Plugin } from "vite";

/** Emits `sw.js`: precaches the app shell and the hashed assets of this build, serves
 *  navigations from the cached shell when offline, and never touches anything else —
 *  `/api`, `/m/` (Range requests on signed URLs) and `/i/` always go to the network. */
export function serviceWorker(): Plugin {
  return {
    name: "musix-sw",
    apply: "build",
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter((f) => f.startsWith("assets/") && !f.endsWith(".map"));
      const version = assets.join("|").length.toString(36) + "-" + Date.now().toString(36);
      const source = `const CACHE = "musix-shell-${version}";
const SHELL = ["/", ...${JSON.stringify(assets.map((a) => "/" + a))}];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (/^\\/(api|m|i|download)\\//.test(url.pathname)) return; // never intercepted
  if (e.request.mode === "navigate") { e.respondWith(fetch(e.request).catch(() => caches.match("/"))); return; }
  if (url.pathname.startsWith("/assets/")) e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}
