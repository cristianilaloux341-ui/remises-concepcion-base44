// RadioCab Service Worker v11 — Push + Background Keep-Alive
const CACHE_NAME = 'radiocab-v11';
const STATIC_ASSETS = ['/', '/index.html', '/icon-192.png', '/icon-512.png'];

// ── Estado interno ────────────────────────────────────────────────────────────
let activeDriverId = null;
let keepAliveInterval = null;

// ── Install & Activate ────────────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
  startKeepAlive();
});

// ── Fetch (network-first) ─────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/') || e.request.url.includes('base44')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── Push notification received ────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data?.json() || {}; } catch (_) { data = { title: '🚖 Nuevo Viaje', body: '' }; }

  const title = data.title || '🚖 ¡Nuevo Viaje!';
  const body  = data.body  || 'Tenés un viaje asignado. Abrí la app.';
  const orderId  = data.orderId;
  const driverId = data.driverId;

  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    vibrate: [500, 200, 500, 200, 1000, 300, 500, 300, 1000],
    requireInteraction: true,
    tag: 'ride-offer',
    renotify: true,
    data: { orderId, driverId, url: '/driver-app' },
    actions: [
      { action: 'accept', title: '✅ Aceptar' },
      { action: 'reject', title: '❌ Rechazar' },
    ],
  };

  e.waitUntil(
    self.registration.showNotification(title, options).then(() => {
      // Despertar la app si está abierta en background
      wakeUpApp({ type: 'NEW_OFFER', orderId, driverId });
    })
  );
});

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { orderId, driverId, url } = e.notification.data || {};

  if (e.action === 'accept' && orderId) {
    e.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        const appClient = clients.find(c => c.url.includes('/driver-app'));
        if (appClient) {
          appClient.postMessage({ type: 'SW_ACCEPT_ORDER', orderId });
          return appClient.focus();
        }
        return self.clients.openWindow('/driver-app');
      })
    );
    return;
  }

  // Default: open the app
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const appClient = clients.find(c => c.url.includes('/driver-app'));
      if (appClient) return appClient.focus();
      return self.clients.openWindow(url || '/driver-app');
    })
  );
});

// ── Message handler (from DriverApp) ─────────────────────────────────────────
self.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'SET_DRIVER') {
    activeDriverId = msg.driverId || null;
  }

  if (msg.type === 'KEEP_ALIVE') {
    // App está viva — responder para confirmar
    e.source?.postMessage({ type: 'SW_ALIVE' });
  }

  if (msg.type === 'SHOW_NOTIFICATION' && msg.order) {
    const order = msg.order;
    self.registration.showNotification('🚖 ¡Nuevo Viaje! — ' + (order.client_name || ''), {
      body: `${order.pickup_address}${order.dropoff_address ? ' → ' + order.dropoff_address : ''}${order.fare ? ' · $' + order.fare : ''}`,
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      vibrate: [500, 200, 500, 200, 1000, 300, 500, 300, 1000],
      requireInteraction: true,
      renotify: true,
      tag: 'ride-offer',
      data: { orderId: order.id, driverId: activeDriverId, url: '/driver-app' },
      actions: [
        { action: 'accept', title: '✅ Aceptar' },
        { action: 'reject', title: '❌ Rechazar' },
      ],
    });
  }

  if (msg.type === 'OFFER_CLEARED') {
    self.registration.getNotifications({ tag: 'ride-offer' })
      .then(notifs => notifs.forEach(n => n.close()));
  }
});

// ── Keep-alive: periodic self-ping to survive mobile OS suspension ────────────
function startKeepAlive() {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      clients.forEach(c => c.postMessage({ type: 'SW_PING' }));
    } else if (activeDriverId) {
      // App cerrada pero hay chofer activo — mantener SW vivo con fetch vacío
      fetch('/ping?' + Date.now()).catch(() => {});
    }
  }, 8000); // cada 8s
}

// ── Wake up app clients ───────────────────────────────────────────────────────
async function wakeUpApp(payload) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ type: 'RECONNECT', ...payload }));

  // BroadcastChannel como fallback adicional
  try {
    const bc = new BroadcastChannel('radiocab_wake');
    bc.postMessage({ type: 'WAKE_UP', driverId: activeDriverId, ...payload });
    bc.close();
  } catch (_) {}
}

// ── Background sync (cuando recupera conexión) ────────────────────────────────
self.addEventListener('sync', (e) => {
  if (e.tag === 'radiocab-keepalive') {
    e.waitUntil(wakeUpApp({ type: 'RECONNECT' }));
  }
});
