// Offline support (keeps the app shell so it opens instantly) and push notifications.
const CACHE = "hybrid-v106";
const FILES = ["./", "./index.html", "./plan.js", "./vendor/leaflet.js", "./vendor/leaflet.css", "./manifest.webmanifest", "./splash/launch-1179x2556.png", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./brand/strava-connect.svg", "./brand/compatible-strava-orange.svg", "./brand/garmin-black.png", "./brand/garmin-white.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  // always ask the server for the newest copy (cheap: unchanged files come back as "not modified"); offline falls back to the saved copy
  const fresh = (e.request.mode === "navigate" ? fetch(e.request.url, {cache: "no-cache", credentials: "same-origin"}) : fetch(e.request, {cache: "no-cache"}))
    .then(r => { if (r && r.ok){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); } return r; });
  const saved = () => caches.match(e.request).then(r => r || (e.request.mode === "navigate" ? caches.match("./index.html") : undefined));
  // Opening the app (Nov 18: a white screen before it opens on a slow connection): the newest copy if the server
  // answers within 1.5 s, otherwise the saved copy right away. The download keeps going and is saved for next time.
  if (e.request.mode === "navigate" || /\/(plan\.js)?(\?.*)?$/.test(new URL(e.request.url).pathname)){
    e.respondWith(new Promise(resolve => {
      let done = false; const use = r => { if (!done && r){ done = true; resolve(r); } };
      const t = setTimeout(() => saved().then(use), 1500);
      fresh.then(r => { clearTimeout(t); use(r); }).catch(() => { clearTimeout(t); saved().then(r => use(r || Response.error())); });
    }));
    return;
  }
  e.respondWith(fresh.catch(() => saved().then(r => r || Response.error())));
});
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch(err){ d = {title: "Mileset", body: e.data ? e.data.text() : ""}; }
  e.waitUntil(self.registration.showNotification(d.title || "Mileset", {body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: d.tag || undefined, data: {url: d.url || "./#today"}}));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./#today", self.location.href).href;
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(list => {
    for (const c of list){ if ("focus" in c){ c.navigate && c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
