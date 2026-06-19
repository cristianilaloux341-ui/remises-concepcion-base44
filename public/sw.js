// RadioCab Service Worker — v9
// Estrategia: polling agresivo + keepalive + notificaciones persistentes

const CACHE_NAME = "radiocab-v9";
const STATIC_ASSETS = ["/", "/index.html", "/driver-app", "/icon-192.png", "/icon-512.png"];

// ── Estado interno ────────────────────────────────────────────────────────────
let myDriverId = null;
let currentOfferedOrderId = null;
let pollInterval = null;
let keepAliveInterval = null;

// ── Instalación ───────────────────────────────────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch — network first, cache fallback ─────────────────────────────────────
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // No interceptar llamadas a la API
  if (url.hostname !== self.location.hostname) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && STATIC_ASSETS.includes(url.pathname)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Keep-alive real: el SW usa un setInterval propio ─────────────────────────
// Esto evita que el browser suspenda el SW cuando la página está en background.
// Enviamos un ping "vacío" a la app cliente y hacemos una mini-fetch para mantener
// el hilo JS activo. Es la técnica más confiable cross-browser en 2024/2025.
function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    // Ping a clientes abiertos
    self.clients.matchAll({ type: "window" }).then((clients) => {
      clients.forEach((c) => c.postMessage({ type: "SW_PING" }));
    });
  }, 15000); // cada 15s — suficiente para evitar suspensión
}

function startPolling() {
  if (pollInterval || !myDriverId) return;
  pollInterval = setInterval(() => checkForOffers(), 8000); // cada 8s como red de seguridad
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// ── Polling de emergencia (cuando la app está en background) ──────────────────
async function checkForOffers() {
  if (!myDriverId) return;

  // Verificar si hay algún cliente activo (app en primer plano)
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const appVisible = clients.some((c) => c.visibilityState === "visible");

  // Si la app está visible y activa, no necesitamos hacer nada — ella misma lo maneja
  // Solo actuamos si está en background (hidden) o sin clientes
  if (appVisible) return;

  // Fetch directo a la API de base44 para verificar si hay una oferta para este chofer
  try {
    // Despertar a la app primero via BroadcastChannel
    const bc = new BroadcastChannel("radiocab_wake");
    bc.postMessage({ type: "WAKE_UP", driverId: myDriverId });
    bc.close();

    // Notificar a los clientes para que reconecten sus suscripciones
    clients.forEach((c) => c.postMessage({ type: "RECONNECT" }));
  } catch (_) {}
}

// ── Manejo de mensajes desde la app ──────────────────────────────────────────
self.addEventListener("message", (e) => {
  const msg = e.data;
  if (!msg) return;

  switch (msg.type) {
    case "SET_DRIVER":
      myDriverId = msg.driverId || null;
      if (myDriverId) {
        startPolling();
        startKeepAlive();
      } else {
        stopPolling();
      }
      break;

    case "KEEP_ALIVE":
      // La app nos confirma que sigue viva — respondemos para mantener el canal abierto
      e.source?.postMessage({ type: "SW_ALIVE" });
      break;

    case "SHOW_NOTIFICATION":
      if (msg.order) {
        currentOfferedOrderId = msg.order.id;
        showRideNotification(msg.order);
      }
      break;

    case "OFFER_CLEARED":
      currentOfferedOrderId = null;
      // Cerrar notificación pendiente si existe
      self.registration.getNotifications({ tag: "ride-offer" }).then((notifs) => {
        notifs.forEach((n) => n.close());
      });
      break;
  }
});

// ── Notificación persistente de viaje ────────────────────────────────────────
function showRideNotification(order) {
  if (Notification.permission !== "granted") return;

  const title = `🚖 ¡Nuevo Viaje! — ${order.client_name || ""}`;
  const body = [
    order.pickup_address,
    order.dropoff_address ? `→ ${order.dropoff_address}` : null,
    order.fare ? `$${order.fare}` : null,
  ].filter(Boolean).join("  ");

  // Cerrar notificación anterior del mismo viaje
  self.registration.getNotifications({ tag: "ride-offer" }).then((prev) => {
    prev.forEach((n) => n.close());

    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-72.png",
      tag: "ride-offer",
      renotify: true,             // re-suena aunque el tag sea el mismo
      requireInteraction: true,   // NO se auto-cierra
      silent: false,
      vibrate: [500, 200, 500, 200, 1000, 300, 500],
      data: { orderId: order.id, driverId: myDriverId, url: "/driver-app" },
      actions: [
        { action: "accept", title: "✅ Aceptar" },
        { action: "reject", title: "❌ Rechazar" },
      ],
    });
  });
}

// ── Click en notificación ─────────────────────────────────────────────────────
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const { action, notification } = e;
  const { orderId, driverId, url } = notification.data || {};

  if (action === "accept" && orderId && driverId) {
    // Informar a la app que acepte
    e.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: "SW_ACCEPT_ORDER", orderId, driverId }));
        // Traer la ventana al frente
        const focused = clients.find((c) => "focus" in c);
        if (focused) return focused.focus();
        return self.clients.openWindow(url || "/driver-app");
      })
    );
    return;
  }

  if (action === "reject") {
    // Solo cerrar la notificación — el timeout en la app manejará el rechazo
    return;
  }

  // Click general: abrir/enfocar la app
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const app = clients.find((c) => c.url.includes("/driver-app"));
      if (app) return app.focus();
      return self.clients.openWindow(url || "/driver-app");
    })
  );
});

// ── Background Sync ───────────────────────────────────────────────────────────
self.addEventListener("sync", (e) => {
  if (e.tag === "radiocab-reconnect") {
    e.waitUntil(checkForOffers());
  }
});

// Arrancar keep-alive de inmediato al cargar el SW
startKeepAlive();
