// ── Remises Concepción — Service Worker ───────────────────────────────────────
const CACHE_NAME = 'remises-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ── Install: pre-cache static assets ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Si algún asset falla, continuar igual
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: limpiar caches viejos ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first con fallback a cache ────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Solo interceptar GET, y no interceptar requests de la API
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname !== location.hostname) return; // no cache de CDN externos

  event.respondWith(
    fetch(request)
      .then(res => {
        // Cachear respuestas exitosas de navegación
        if (res.ok && (request.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request).then(cached => {
        if (cached) return cached;
        // Para navegación, devolver el index.html desde cache
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      }))
  );
});

// ── Push: mostrar notificación cuando llega un push ──────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'Remises', body: event.data ? event.data.text() : 'Nuevo mensaje' };
  }

  const title = data.title || 'Remises Concepción';
  const options = {
    body: data.body || 'Tenés un nuevo mensaje',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'remises-msg-' + Date.now(),
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 400],
    data: {
      url: data.url || '/messages',
      type: data.type,
      orderId: data.orderId,
    },
    actions: data.type === 'NEW_RIDE'
      ? [
          { action: 'accept', title: '✅ Aceptar' },
          { action: 'reject', title: '❌ Rechazar' },
        ]
      : [
          { action: 'open', title: '💬 Abrir chat' },
        ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: abrir la app en la URL correcta ──────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/messages';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Si ya hay una ventana abierta, enfocarla y navegar
      for (const client of windowClients) {
        if (client.url.includes(location.origin)) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Si no hay ventana, abrir una nueva
      return clients.openWindow(targetUrl);
    })
  );
});

// ── Keep-alive ping-pong (25s) para evitar suspensión en Android ──────────────
self.addEventListener('message', (event) => {
  if (event.data === 'ping') {
    event.source?.postMessage('pong');
  }
});
