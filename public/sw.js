/**
 * Service Worker — RadioCab / Remisería
 * 
 * Responsabilidades:
 * 1. Recibir push notifications (FCM/VAPID) cuando la app está muerta o en background
 * 2. Mostrar notificación persistente "En Servicio" mientras el chofer está conectado
 * 3. Keep-alive periódico para mantener el SW activo
 * 4. Manejar clics en notificaciones y abrir la app
 * 5. Caché offline básico para que la app cargue sin internet
 */

const SW_VERSION = "v4";
const CACHE_NAME = "radiocab-" + SW_VERSION;
const KEEPALIVE_TAG = "radiocab-keepalive";

// ── Keep-alive: el SW hace un fetch periódico para no ser matado ──────────────
// Solo en Android/Chrome donde el SW puede ser terminado por inactividad
self.addEventListener("periodicsync", (event) => {
  if (event.tag === KEEPALIVE_TAG) {
    event.waitUntil(handlePeriodicSync());
  }
});

async function handlePeriodicSync() {
  // Notificar a la página que siga viva
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach(c => c.postMessage({ type: "SW_ALIVE" }));
}

// ── Push notifications (FCM / VAPID) ─────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch (_) {
    data = { title: "🚖 Nuevo viaje disponible", body: event.data?.text() ?? "" };
  }

  const title = data.title || "🚖 ¡Nuevo Viaje!";
  const options = {
    body: data.body || "Abrí la app para ver los detalles",
    icon: "/icon-192.png",
    badge: "/icon-72.png",
    image: data.image || undefined,
    vibrate: [500, 200, 500, 200, 1000, 300, 500],
    requireInteraction: true,           // No desaparece sola en Android
    tag: data.tag || "ride-offer",      // Reemplaza notificación anterior del mismo tipo
    renotify: true,                     // Re-vibra aunque reemplace una existente
    silent: false,
    data: {
      orderId: data.orderId || null,
      url: data.url || "/driver-app",
      driverId: data.driverId || null,
      type: data.type || "ride-offer",
    },
    actions: [
      { action: "accept", title: "✅ Aceptar", icon: "/icon-accept.png" },
      { action: "reject", title: "❌ Rechazar", icon: "/icon-reject.png" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Manejar clic en notificación ──────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  const { action, notification } = event;
  const { orderId, url, driverId, type } = notification.data || {};

  notification.close();

  if (action === "accept" && orderId) {
    // Aceptar el viaje directamente sin abrir la app
    event.waitUntil(
      (async () => {
        // Intentar avisar a la pestaña abierta
        const clients = await self.clients.matchAll({ type: "window" });
        const appClient = clients.find(c => c.url.includes("/driver-app"));
        if (appClient) {
          appClient.postMessage({ type: "SW_ACCEPT_ORDER", orderId });
          appClient.focus();
        } else {
          // Abrir la app y pasar el orderId por URL hash
          await self.clients.openWindow(`/driver-app#accept=${orderId}`);
        }
      })()
    );
    return;
  }

  if (action === "reject") {
    // Solo cerrar la notificación — la app hará el rechazo cuando se abra
    return;
  }

  // Clic en el cuerpo de la notificación — abrir/enfocar la app
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const appClient = clients.find(c => c.url.includes("/driver-app"));
      if (appClient) {
        await appClient.focus();
      } else {
        await self.clients.openWindow(url || "/driver-app");
      }
    })()
  );
});

// ── notificationclose ─────────────────────────────────────────────────────────
self.addEventListener("notificationclose", (event) => {
  const data = event.notification.data || {};
  if (data.type === "in-service") return; // No hacer nada si cierra la persistente
});

// ── Mensajes desde la página ──────────────────────────────────────────────────
let currentDriverId = null;

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg) return;

  switch (msg.type) {
    case "SET_DRIVER":
      currentDriverId = msg.driverId || null;
      if (currentDriverId) {
        showInServiceNotification(currentDriverId, msg.driverName);
      } else {
        clearInServiceNotification();
      }
      break;

    case "SHOW_NOTIFICATION":
      if (msg.order) showRideOffer(msg.order);
      break;

    case "OFFER_CLEARED":
      // Limpiar notificación de oferta activa
      self.registration.getNotifications({ tag: "ride-offer" })
        .then(notifs => notifs.forEach(n => n.close()));
      self.registration.getNotifications({ tag: "broadcast-offer" })
        .then(notifs => notifs.forEach(n => n.close()));
      break;

    case "SHOW_PERSISTENT":
      showInServiceNotification(msg.driverId, msg.driverName);
      break;

    case "CLEAR_PERSISTENT":
      clearInServiceNotification();
      break;

    case "KEEP_ALIVE":
      // La página nos confirmó que está viva — nada que hacer
      break;

    case "SW_PING":
      event.source?.postMessage({ type: "SW_PONG" });
      break;
  }
});

// ── Notificación persistente "En Servicio" ────────────────────────────────────
// Simula el Foreground Service de Android: una notificación fija en el panel
// que Android no puede descartar (requireInteraction:true + sin timeout)
async function showInServiceNotification(driverId, driverName) {
  if (!driverId) return;
  const name = driverName || "Chofer";
  await self.registration.showNotification("🟢 Remisería — En Servicio", {
    body: `${name} · Conectado y esperando viajes`,
    icon: "/icon-192.png",
    badge: "/icon-72.png",
    tag: "in-service",             // Tag único: reemplaza la anterior
    renotify: false,               // No re-vibrar al actualizar
    silent: true,                  // Sin sonido para la persistente
    requireInteraction: false,     // En Android se mantiene en la barra sin bloquear
    data: { type: "in-service", driverId, url: "/driver-app" },
  });
}

async function clearInServiceNotification() {
  const notifs = await self.registration.getNotifications({ tag: "in-service" });
  notifs.forEach(n => n.close());
}

// ── Mostrar oferta de viaje ───────────────────────────────────────────────────
function showRideOffer(order) {
  const isBroadcast = order.notes?.includes("[BROADCAST]");
  const tag = isBroadcast ? "broadcast-offer" : "ride-offer";
  const title = isBroadcast ? "📢 Viaje para todos — ¡tomalo vos!" : "🚖 ¡Nuevo Viaje Asignado!";
  const body = [
    order.pickup_address,
    order.dropoff_address ? `→ ${order.dropoff_address}` : null,
    order.fare ? `$${order.fare.toLocaleString()}` : null,
  ].filter(Boolean).join("  ");

  return self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-72.png",
    vibrate: [500, 200, 500, 200, 1000, 300, 500],
    requireInteraction: true,
    tag,
    renotify: true,
    silent: false,
    data: { orderId: order.id, type: "ride-offer", url: "/driver-app" },
    actions: [
      { action: "accept", title: "✅ Aceptar" },
      { action: "reject", title: "❌ Rechazar" },
    ],
  });
}

// ── Install / Activate ────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      // Limpiar cachés viejos
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    })()
  );
});

// ── Fetch: cache-first para assets estáticos, network-first para API ─────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // No interceptar llamadas a la API de Base44
  if (url.hostname.includes("base44") || url.pathname.startsWith("/api/")) return;

  // Solo GET
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).catch(() => cached);
    })
  );
});
