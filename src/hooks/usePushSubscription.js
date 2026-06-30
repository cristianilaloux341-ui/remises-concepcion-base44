import { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

/**
 * Registra la push subscription del navegador o nativa (FCM) para este chofer.
 */
export function usePushSubscription(driverId) {
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!driverId || subscribedRef.current) return;

    let cancelled = false;

    async function registerNative() {
      try {
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }
        if (permStatus.receive !== 'granted') {
          await base44.entities.AuditLog.create({
            action: 'push_error',
            user_type: 'sistema',
            user_name: 'Chofer ' + driverId,
            details: 'Push Nativo sin permiso: ' + permStatus.receive
          }).catch(()=>{});
          return;
        }

        await PushNotifications.register();
        await base44.entities.AuditLog.create({
          action: 'push_debug',
          user_type: 'sistema',
          user_name: 'Chofer ' + driverId,
          details: 'PushNotifications.register() ejecutado'
        }).catch(()=>{});

        PushNotifications.addListener('registration', async (token) => {
          if (cancelled) return;
          await base44.functions.invoke("sendPushNotification", {
            action: "subscribe_fcm",
            driverId,
            token: token.value,
          });
          subscribedRef.current = true;
        });

        PushNotifications.addListener('registrationError', (error) => {
          console.error('Error al registrar FCM: ', error);
          base44.entities.AuditLog.create({
            action: 'push_error',
            user_type: 'sistema',
            user_name: 'Chofer ' + driverId,
            details: 'FCM Reg Error: ' + (error.error || JSON.stringify(error))
          }).catch(()=>{});
        });
      } catch (e) {
        console.error("Error en Push Nativo", e);
        base44.entities.AuditLog.create({
          action: 'push_error',
          user_type: 'sistema',
          user_name: 'Chofer ' + driverId,
          details: 'Error catch Push Nativo: ' + e.message
        }).catch(()=>{});
      }
    }

    async function registerWeb() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
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
        
        // FORZAR RENOVACIÓN: Google a veces invalida la suscripción en segundo plano sin avisar.
        // También soluciona cuando cambian las claves VAPID en el servidor.
        if (sub) {
          try {
            await sub.unsubscribe();
          } catch (e) {
            console.warn("Error al desuscribir la vieja key", e);
          }
          sub = null;
        }

        // Suscribir nuevamente de cero si el permiso ya fue concedido
        if (!sub && ("Notification" in window) && Notification.permission === "granted") {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          });
        }

        if (!sub) return; // Si no hay suscripción (y no tenemos permiso), salimos

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
        base44.entities.AuditLog.create({
          action: 'push_error',
          user_type: 'sistema',
          user_name: 'Chofer ' + driverId,
          details: 'Web Push Error: ' + err.message
        }).catch(()=>{});
      }
    }

    if (Capacitor.isNativePlatform()) {
      registerNative();
    } else {
      registerWeb();
    }

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