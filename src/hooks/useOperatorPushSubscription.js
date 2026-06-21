import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

/**
 * Registra la push subscription del navegador para un operador (admin).
 * Así puede recibir notificaciones push de mensajes de choferes aunque
 * tenga la pantalla bloqueada o la app en segundo plano.
 */
export function useOperatorPushSubscription(user) {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!user?.id || subscribedRef.current) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    let cancelled = false;

    async function register() {
      try {
        // Pedir permiso de notificaciones
        const permission = await Notification.requestPermission();
        if (permission !== "granted" || cancelled) return;

        // Obtener VAPID public key
        const res = await base44.functions.invoke("sendPushNotification", {
          action: "vapid_public_key",
        });
        const vapidPublicKey = res?.data?.publicKey;
        if (!vapidPublicKey || cancelled) return;

        const reg = await navigator.serviceWorker.ready;

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
          action: "subscribe_operator",
          userId: user.id,
          subscription: sub.toJSON(),
        });

        subscribedRef.current = true;
      } catch (err) {
        console.warn("[Push Operator] No se pudo registrar:", err?.message || err);
      }
    }

    register();
    return () => { cancelled = true; };
  }, [user?.id]);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}