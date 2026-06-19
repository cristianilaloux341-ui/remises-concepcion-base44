import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Registra la push subscription del navegador para este chofer.
 * Al recibir un viaje ofrecido, el dashboard llama a sendPushToDriver().
 */
export function usePushSubscription(driverId) {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!driverId || subscribedRef.current) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    let cancelled = false;

    async function register() {
      try {
        // Obtener VAPID public key del backend
        const res = await base44.functions.invoke("sendPushNotification", {
          action: "vapid_public_key",
        });
        const vapidPublicKey = res?.data?.publicKey;
        if (!vapidPublicKey || cancelled) return;

        const reg = await navigator.serviceWorker.ready;

        // Verificar si ya hay una suscripción activa
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          });
        }

        if (cancelled) return;

        // Registrar en el backend
        await base44.functions.invoke("sendPushNotification", {
          action: "subscribe",
          driverId,
          subscription: sub.toJSON(),
        });

        subscribedRef.current = true;
      } catch (err) {
        console.warn("[Push] No se pudo registrar:", err?.message || err);
      }
    }

    register();
    return () => { cancelled = true; };
  }, [driverId]);
}

// Convierte la clave VAPID Base64URL a Uint8Array (requerido por pushManager.subscribe)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}