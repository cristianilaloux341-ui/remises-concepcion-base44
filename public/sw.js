// Service Worker — Remisería Concepción
// Maneja notificaciones push, acciones de notificación y cache básico

const CACHE_NAME = "remiseria-v2";

// ── Install & Activate ────────────────────────────────────────────────────────
self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── State: viaje ofrecido actual ──────────────────────────────────────────────
let currentDriverId = null;
let currentOffer = null;  // { id, client_name, pickup_address, dropoff_address, fare }

// ── Message from app ──────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "SET_DRIVER") {
    currentDriverId = msg.driverId;
  }

  if (msg.type === "SHOW_NOTIFICATION") {
    currentOffer = msg.order;
    showRideNotification(msg.order);
  }

  if (msg.type === "OFFER_CLEARED") {
    currentOffer = null;
    // Cerrar notificaciones previas de viaje
    self.registration.getNotifications({ tag: "ride-offer" }).then((notifs) => {
      notifs.forEach((n) => n.close());
    });
  }
});

// ── Show notification with actions ───────────────────────────────────────────
function showRideNotification(order) {
  if (!order) return;

  const body = [
    order.pickup_address,
    order.dropoff_address ? "→ " + order.dropoff_address : "",
    order.fare ? "$" + order.fare.toLocaleString() : "",
  ].filter(Boolean).join("  ");

  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-72.png",
    tag: "ride-offer",         // reemplaza la anterior (no se apilan)
    renotify: true,            // fuerza vibración/sonido aunque tag sea igual
    requireInteraction: true,  // no desaparece sola
    vibrate: [500, 200, 500, 200, 1000, 300, 500],
    silent: false,
    data: { orderId: order.id, order },
    actions: [
      { action: "accept", title: "✅ Aceptar" },
      { action: "reject", title: "❌ Rechazar" },
    ],
  };

  // Intentar con sonido propio si el browser lo soporta
  if ("sound" in Notification.prototype) {
    options.sound = "/alert.ogg";
  }

  self.registration.showNotification("🚖 ¡Nuevo Viaje! — " + (order.client_name || ""), options).catch(() => {});
}

// ── Notification click handler ────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const action = event.action;
  const order = event.notification.data?.order;

  if (action === "accept" && order) {
    // Intentar actualizar la orden directamente desde el SW (fetch)
    event.waitUntil(
      acceptOrderFromSW(order).then(() => focusOrOpenApp())
    );
  } else if (action === "reject" && order) {
    event.waitUntil(focusOrOpenApp());
  } else {
    // Click en el cuerpo de la notif — abrir la app
    event.waitUntil(focusOrOpenApp());
  }
});

async function acceptOrderFromSW(order) {
  // No tenemos acceso directo al SDK de base44 desde SW,
  // así que enviamos un mensaje a todos los clientes abiertos para que procesen la acción
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => {
    client.postMessage({ type: "SW_ACCEPT_ORDER", orderId: order.id });
  });
}

async function focusOrOpenApp() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const appClient = clients.find((c) => c.url.includes("/driver-app"));
  if (appClient) {
    return appClient.focus();
  }
  return self.clients.openWindow("/driver-app");
}

// ── Push event (Web Push nativo, si se implementa backend VAPID en el futuro) ──
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch (_) {}
  if (data.order) {
    event.waitUntil(showRideNotification(data.order));
  }
});

// ── Fetch (cache-first para assets estáticos) ─────────────────────────────────
self.addEventListener("fetch", (event) => {
  // Solo cachear assets estáticos, no API calls
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;

  // Pass-through — sin cache agresivo para no interferir con tiempo real
  return;
});
