// ── RadioCab Service Worker ────────────────────────────────────────────────────
// Versión con notificaciones push con botones Aceptar / Rechazar

const CACHE_NAME = "radiocab-v2";

// ── Install & Activate ────────────────────────────────────────────────────────
self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

// ── Keep-alive ping ───────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "SET_DRIVER") {
    self._driverId = msg.driverId;
    self._driverName = msg.driverName;
  }

  if (msg.type === "SW_PING" || msg.type === "KEEP_ALIVE") {
    // Responder al ping para confirmar que el SW sigue vivo
    event.source?.postMessage({ type: "SW_ALIVE" });
  }

  if (msg.type === "SHOW_NOTIFICATION") {
    const order = msg.order;
    if (!order) return;
    const title = `🚖 ¡Nuevo Viaje! — ${order.client_name || ""}`;
    const body = [
      order.pickup_address,
      order.dropoff_address ? `→ ${order.dropoff_address}` : null,
      order.fare ? `💵 $${order.fare}` : null,
    ].filter(Boolean).join("  ");

    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-72.png",
      vibrate: [500, 200, 500, 200, 1000],
      requireInteraction: true,
      tag: "ride-offer",
      renotify: true,
      data: { orderId: order.id, driverId: self._driverId },
      actions: [
        { action: "accept", title: "✅ Aceptar" },
        { action: "reject", title: "❌ Rechazar" },
      ],
    });
  }

  if (msg.type === "OFFER_CLEARED") {
    self.registration.getNotifications({ tag: "ride-offer" }).then((notifs) => {
      notifs.forEach((n) => n.close());
    });
  }
});

// ── Push (desde servidor VAPID) ───────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch (_) {}

  const order = data.order || {};
  const title = data.title || `🚖 ¡Nuevo Viaje!`;
  const body = data.body || [
    order.pickup_address,
    order.dropoff_address ? `→ ${order.dropoff_address}` : null,
    order.fare ? `💵 $${order.fare}` : null,
  ].filter(Boolean).join("  ") || "Nuevo pasaje disponible";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-72.png",
      vibrate: [500, 200, 500, 200, 1000],
      requireInteraction: true,
      tag: "ride-offer",
      renotify: true,
      data: {
        orderId: order.id || data.orderId,
        driverId: data.driverId,
        url: "/driver-app",
      },
      actions: [
        { action: "accept", title: "✅ Aceptar" },
        { action: "reject", title: "❌ Rechazar" },
      ],
    })
  );
});

// ── Notification click / action ───────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const action = event.action; // "accept" | "reject" | "" (toque en el cuerpo)
  const { orderId, driverId } = notification.data || {};

  notification.close();

  if (action === "accept" && orderId && driverId) {
    // Aceptar desde pantalla bloqueada: avisar a la app si está abierta,
    // o hacer la llamada a la API directamente desde el SW.
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        // Si la app está abierta, delegamos a ella
        const appClient = clients.find((c) => c.url.includes("/driver-app"));
        if (appClient) {
          appClient.postMessage({ type: "SW_ACCEPT_ORDER", orderId, driverId });
          return appClient.focus();
        }
        // App cerrada: abrir y pasar el mensaje para que lo procese al montar
        return self.clients.openWindow(`/driver-app?accept=${orderId}`);
      })
    );
    return;
  }

  if (action === "reject") {
    // Solo cerrar la notificación; el timeout del servidor reasignará
    return;
  }

  // Toque en el cuerpo: abrir / enfocar la app
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const appClient = clients.find((c) => c.url.includes("/driver-app"));
      if (appClient) return appClient.focus();
      return self.clients.openWindow("/driver-app");
    })
  );
});

// ── Background sync (keep-alive) ──────────────────────────────────────────────
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "radiocab-keepalive") {
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: "RECONNECT" }));
      })
    );
  }
});
