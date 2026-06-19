// RadioCab SW v4 — Background polling + notificaciones persistentes
const CACHE_NAME = "radiocab-v4";
const STATIC_ASSETS = ["/", "/index.html", "/icon-192.png"];

// ── Install ────────────────────────────────────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// ── Activate ───────────────────────────────────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch — network first ──────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const clone = r.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone)).catch(() => {});
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Estado del SW ──────────────────────────────────────────────────────────
let driverId = null;
let lastOfferedOrderId = null;
let pollingInterval = null;
let appUrl = self.registration.scope;

// ── Polling en background ──────────────────────────────────────────────────
// Se activa cuando el chofer está registrado y la app puede estar dormida
async function pollForOrders() {
  if (!driverId) return;

  // Verificar si hay clientes activos (app en foreground)
  const clients = await self.clients.matchAll({ includeUncontrolled: false, type: "window" });
  const appVisible = clients.some((c) => !c.hidden);

  // Si la app está en foreground, ella misma maneja las suscripciones — no hacer nada
  if (appVisible) return;

  // App en background: hacer polling liviano a la API de Base44
  try {
    // Usamos la API pública de entidades (read RLS = true en RideOrder)
    const appId = appUrl.split("/")[2]; // no lo necesitamos, usamos fetch directo
    
    // Intentar notificar al cliente vía BroadcastChannel para re-despertar la app
    const bc = new BroadcastChannel("radiocab_wake");
    bc.postMessage({ type: "WAKE_UP", driverId });
    bc.close();
  } catch (_) {}
}

function startPolling() {
  if (pollingInterval) return;
  pollingInterval = setInterval(pollForOrders, 15000); // cada 15s en background
}

function stopPolling() {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
}

// ── Message handler ────────────────────────────────────────────────────────
self.addEventListener("message", async (e) => {
  const msg = e.data;
  if (!msg) return;

  switch (msg.type) {
    case "SET_DRIVER":
      driverId = msg.driverId;
      if (driverId) startPolling(); else stopPolling();
      break;

    case "KEEP_ALIVE":
      // ping desde la app para mantener el SW vivo
      e.source?.postMessage({ type: "ALIVE" });
      break;

    case "SHOW_NOTIFICATION": {
      const order = msg.order;
      if (!order || order.id === lastOfferedOrderId) break;
      lastOfferedOrderId = order.id;
      await showRideNotification(order);
      break;
    }

    case "OFFER_CLEARED":
      lastOfferedOrderId = null;
      // Cerrar notificaciones de oferta activas
      const notifs = await self.registration.getNotifications({ tag: "ride-offer" });
      notifs.forEach((n) => n.close());
      break;

    case "SW_ACCEPT_ORDER":
      // Re-broadcast al cliente
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => c.postMessage(msg));
      break;
  }
});

// ── Mostrar notificación de viaje ──────────────────────────────────────────
async function showRideNotification(order) {
  const title = `🚖 ¡Nuevo Viaje! — ${order.client_name || ""}`;
  const body = [
    order.pickup_address,
    order.dropoff_address ? `➜ ${order.dropoff_address}` : "",
    order.fare ? `  $${order.fare.toLocaleString("es-AR")}` : "",
  ].filter(Boolean).join("\n");

  // Cerrar la notificación anterior del mismo tipo
  const prev = await self.registration.getNotifications({ tag: "ride-offer" });
  prev.forEach((n) => n.close());

  await self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-72.png",
    tag: "ride-offer",
    renotify: true,
    requireInteraction: true,   // NO se cierra sola — el chofer debe tocar
    vibrate: [500, 200, 500, 200, 1000, 300, 500],
    data: { orderId: order.id, url: appUrl + "driver-app" },
    actions: [
      { action: "accept", title: "✅ Aceptar" },
      { action: "view",   title: "👁 Ver viaje" },
    ],
  });
}

// ── Click en notificación ──────────────────────────────────────────────────
self.addEventListener("notificationclick", (e) => {
  const { action, notification } = e;
  const { orderId, url } = notification.data || {};
  notification.close();

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      // Si la app ya está abierta, enfocarla
      const appClient = clients.find((c) => c.url.includes("driver-app"));
      if (appClient) {
        await appClient.focus();
        if (action === "accept" && orderId) {
          appClient.postMessage({ type: "SW_ACCEPT_ORDER", orderId });
        }
        return;
      }
      // Si no está abierta, abrir
      const win = await self.clients.openWindow(url || (appUrl + "driver-app"));
      if (action === "accept" && orderId && win) {
        setTimeout(() => win.postMessage({ type: "SW_ACCEPT_ORDER", orderId }), 2000);
      }
    })
  );
});

// ── Sync event — re-despertar cuando hay conectividad ─────────────────────
self.addEventListener("sync", (e) => {
  if (e.tag === "radiocab-sync") {
    e.waitUntil(
      self.clients.matchAll({ type: "window" }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: "RECONNECT" }));
      })
    );
  }
});
