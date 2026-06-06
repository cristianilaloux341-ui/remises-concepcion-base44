// ============================================================
// SERVICE WORKER — RadioCab Dispatch
// Maneja notificaciones push, caché y background sync
// ============================================================

const CACHE_NAME = "radiocab-v2";
const STATIC_ASSETS = ["/", "/driver-app"];

// ── Install ──────────────────────────────────────────────────
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch — Network first, fallback to cache ─────────────────
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  // Solo cachear recursos propios (no APIs externas)
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push Notifications ────────────────────────────────────────
self.addEventListener("push", (e) => {
  const data = e.data?.json() ?? {};
  const title = data.title || "RadioCab";
  const options = {
    body: data.body || "Nueva notificación",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "radiocab",
    renotify: true,
    requireInteraction: data.requireInteraction ?? true,
    data: data.url ? { url: data.url } : {},
    vibrate: [200, 100, 200],
    actions: data.actions || [],
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click ────────────────────────────────────────
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/driver-app";

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url) || c.url.includes("/driver-app"));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// ── Message from app ──────────────────────────────────────────
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();

  // Ping desde la app para mantener el SW vivo en background
  if (e.data?.type === "KEEPALIVE") {
    e.source?.postMessage({ type: "KEEPALIVE_ACK", ts: Date.now() });
  }

  // Mostrar notificación local (sin push server)
  if (e.data?.type === "SHOW_NOTIFICATION") {
    const { title, body, tag, url } = e.data;
    self.registration.showNotification(title || "RadioCab", {
      body: body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: tag || "radiocab-local",
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { url },
    });
  }
});

// ── Background Sync ───────────────────────────────────────────
self.addEventListener("sync", (e) => {
  if (e.tag === "background-sync") {
    // Notificar a todos los clientes que reconecten
    e.waitUntil(
      self.clients.matchAll().then((clients) =>
        clients.forEach((c) => c.postMessage({ type: "RECONNECT" }))
      )
    );
  }
});
