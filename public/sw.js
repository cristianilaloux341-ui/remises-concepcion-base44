// Service Worker - Background polling for ride offers
const POLL_INTERVAL = 3000; // 3 seconds

let pollTimer = null;
let currentDriverId = null;
let lastOfferedId = null;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Receive messages from the main app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SET_DRIVER') {
    currentDriverId = event.data.driverId;
    if (currentDriverId) {
      startPolling();
    } else {
      stopPolling();
    }
  }
  if (event.data?.type === 'OFFER_CLEARED') {
    lastOfferedId = null;
  }
});

function startPolling() {
  stopPolling();
  pollTimer = setInterval(checkForOffers, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function checkForOffers() {
  if (!currentDriverId) return;
  try {
    // We need to get the app's base URL from the clients
    const clients = await self.clients.matchAll();
    const appUrl = clients[0]?.url || self.registration.scope;
    const baseUrl = new URL(appUrl).origin;

    // Poll via the app's API - we replicate the same call the app does
    // Since we can't use the SDK here, we skip direct API calls.
    // Instead, notify the open clients to check and show notification if needed.
    if (clients.length === 0) {
      // App is closed/backgrounded - can't poll without auth token
      // Show a reminder notification to open the app
    } else {
      // App is open - send a message to poll
      clients.forEach(client => client.postMessage({ type: 'POLL_NOW' }));
    }
  } catch (_) {}
}

// Show notification when triggered by the app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SHOW_NOTIFICATION') {
    const { order } = event.data;
    if (order && order.id !== lastOfferedId) {
      lastOfferedId = order.id;
      self.registration.showNotification('🚖 ¡Nuevo Viaje!', {
        body: order.pickup_address + (order.dropoff_address ? ' → ' + order.dropoff_address : ''),
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [400, 200, 400, 200, 800],
        requireInteraction: true,
        tag: 'ride-offer',
        renotify: true,
        actions: [
          { action: 'accept', title: '✅ Aceptar' },
          { action: 'reject', title: '❌ Rechazar' },
        ],
      });
    }
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      if (clients.length > 0) {
        clients[0].focus();
      } else {
        self.clients.openWindow('/driver-app');
      }
    })
  );
});
