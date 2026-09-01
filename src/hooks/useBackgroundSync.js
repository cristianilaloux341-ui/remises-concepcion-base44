import { useEffect, useRef, useCallback } from "react";
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * useBackgroundSync — Detecta cuando la app vuelve al primer plano después de
 * estar en background y ejecuta un callback de reconexión.
 * También envía pings periódicos al Service Worker para mantenerlo vivo.
 *
 * @param {Function} onResume — callback que se llama al volver al primer plano
 * @param {number}   pingInterval — ms entre pings al SW (default: 20s)
 */
export function useBackgroundSync(onResume, pingInterval = 120_000) {
  const onResumeRef = useRef(onResume);
  const pingTimerRef = useRef(null);
  const jsHeartbeatRef = useRef(null);
  const wasHiddenRef = useRef(false);

  useEffect(() => { onResumeRef.current = onResume; }, [onResume]);

  // Ping al SW para mantenerlo vivo
  const pingSW = useCallback(() => {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "KEEP_ALIVE" });
    }
  }, []);

  useEffect(() => {
    // Android nativo se despierta por FCM. No mantenemos el WebView activo
    // ni hacemos reconexiones periódicas con la pantalla apagada.
    // Eso evita CPU/red innecesarias y reduce mucho el consumo de batería.

    // Escuchar mensajes del SW (reconexión solicitada desde background sync)
    const onSWMessage = (e) => {
      if (e.data?.type === "RECONNECT") {
        console.log("[Realtime] Reconexión solicitada por mensaje RECONNECT del Service Worker.");
        onResumeRef.current?.();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSWMessage);

    // Eventos Nativos de Capacitor (La mejor forma en Android/iOS)
    let appStateListener = null;
    if (Capacitor.isNativePlatform()) {
      App.addListener('appStateChange', (state) => {
        console.log(`[Realtime-Capacitor] Evento appStateChange. Estado de la app nativa: isActive=${state.isActive}`);
        if (state.isActive) {
          console.log("[Realtime-Capacitor] App volvió a primer plano. Disparando reconexión...");
          wasHiddenRef.current = false;
          onResumeRef.current?.();
          pingSW();
        } else {
          console.log("[Realtime-Capacitor] App pasó a segundo plano o se bloqueó la pantalla.");
          wasHiddenRef.current = true;
        }
      }).then(listener => {
        appStateListener = listener;
      });
    }

    // Detectar visibilidad DOM (Backup para PWA / Web)
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        console.log("[Realtime-DOM] visibilityState=visible. Intentando reconectar...");
        if (wasHiddenRef.current) {
          wasHiddenRef.current = false;
          onResumeRef.current?.();
          pingSW();
        }
      } else if (document.visibilityState === "hidden") {
        console.log("[Realtime-DOM] visibilityState=hidden. App suspendida.");
        wasHiddenRef.current = true;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Detectar foco de ventana (Complementario)
    const onFocus = () => {
      if (wasHiddenRef.current) {
        console.log("[Realtime-DOM] focus recuperado. Reconectando...");
        wasHiddenRef.current = false;
        onResumeRef.current?.();
      }
    };
    window.addEventListener("focus", onFocus);

    // Detectar cambios de red
    const onOnline = () => {
      console.log("[Realtime-Network] Red restablecida (Online). Disparando reconexión...");
      onResumeRef.current?.();
    };
    const onOffline = () => {
      console.log("[Realtime-Network] Red perdida (Offline). Conexión interrumpida.");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Evento Custom
    const onCustomReconnect = () => {
      console.log("[Realtime-Custom] Reconexión solicitada por radiocab_reconnect.");
      onResumeRef.current?.();
    };
    window.addEventListener("radiocab_reconnect", onCustomReconnect);

    // En Android nativo FCM se encarga del background. El ping al SW queda
    // solo para navegador/PWA y únicamente mientras la app está visible.
    if (!Capacitor.isNativePlatform()) {
      pingTimerRef.current = setInterval(() => {
        if (document.visibilityState === "visible") pingSW();
      }, Math.max(pingInterval, 120_000));
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("radiocab_reconnect", onCustomReconnect);
      navigator.serviceWorker?.removeEventListener("message", onSWMessage);
      clearInterval(pingTimerRef.current);
      clearInterval(jsHeartbeatRef.current);
      if (appStateListener) {
        appStateListener.remove();
      }
    };
  }, [pingInterval, pingSW]);
}