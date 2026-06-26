// Service Worker — Remises Concepción
// v2026-06-26b — bump para invalidar cache vieja

const CACHE_NAME = "radiocab-v5";

// Responder a skip waiting para actualizaciones inmediatas
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (!event.data) return;
  const msg = event.data;

  if (msg.type === "SET_DRIVER") {
    currentDriverId = msg.driverId || null;
    currentDriverName = msg.driverName || null;
  }

  if (msg.type === "SHOW_NOTIFICATION") {
    const order = msg.order;
    if (!order) return;
    showRideNotification(order);
  }

  if (msg.type === "OFFER_CLEARED") {
    // Cerrar notificaciones de oferta pendiente
    self.registration.getNotifications({ tag: "ride-offer" }).then(notifs => {
      notifs.forEach(n => n.close());
    });
  }

  if (msg.type === "SW_PING" || msg.type === "KEEP_ALIVE") {
    // Responder con pong para mantener el canal vivo
    if (event.source) event.source.postMessage({ type: "SW_ALIVE" });
  }
});

let currentDriverId = null;
let currentDriverName = null;

function showRideNotification(order) {
  if (!order) return;
  const title = "🚖 ¡Nuevo Viaje!";
  const body = [
    order.pickup_address,
    order.dropoff_address ? "→ " + order.dropoff_address : "",
    order.fare ? "$" + order.fare : "",
  ].filter(Boolean).join("  ");

  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-72.png",
    tag: "ride-offer",
    renotify: true,
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 1000],
    data: { orderId: order.id, driverId: currentDriverId },
    actions: [
      { action: "accept", title: "✅ Aceptar" },
      { action: "reject", title: "❌ Rechazar" },
    ],
  };

  self.registration.showNotification(title, options).catch(() => {});
}

// Manejar clicks en acciones de notificación
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { action, notification } = event;
  const { orderId, driverId } = notification.data || {};

  if (action === "accept" && orderId && driverId) {
    // Notificar a la app abierta si existe
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then(clients => {
        const appClient = clients.find(c => c.url.includes("/driver-app"));
        if (appClient) {
          appClient.postMessage({ type: "SW_ACCEPT_ORDER", orderId });
          appClient.focus();
        } else {
          // Abrir la app con parámetro de aceptación automática
          self.clients.openWindow(`/driver-app?accept=${orderId}`);
        }
      })
    );
    return;
  }

  // Click en la notificación (sin acción específica) → abrir/enfocar la app
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then(clients => {
      const appClient = clients.find(c => c.url.includes("/driver-app"));
      if (appClient) { appClient.focus(); return; }
      self.clients.openWindow("/driver-app");
    })
  );
});

// Activación: tomar control inmediato de todas las pestañas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Install: no cachear nada (la app es dinámica)
self.addEventListener("install", () => {
  // No hacer skipWaiting aquí para no romper clientes activos
  // La actualización se maneja via mensaje SKIP_WAITING desde la app
});
