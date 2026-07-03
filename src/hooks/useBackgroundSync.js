import { useEffect, useRef, useCallback } from "react";

/**
 * useBackgroundSync — Detecta cuando la app vuelve al primer plano después de
 * estar en background y ejecuta un callback de reconexión.
 * También envía pings periódicos al Service Worker para mantenerlo vivo.
 *
 * @param {Function} onResume — callback que se llama al volver al primer plano
 * @param {number}   pingInterval — ms entre pings al SW (default: 20s)
 */
export function useBackgroundSync(onResume, pingInterval = 20_000) {
  const onResumeRef = useRef(onResume);
  const pingTimerRef = useRef(null);
  const wasHiddenRef = useRef(false);

  useEffect(() => { onResumeRef.current = onResume; }, [onResume]);

  // Ping al SW para mantenerlo vivo
  const pingSW = useCallback(() => {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "KEEP_ALIVE" });
    }
  }, []);

  useEffect(() => {
    // Escuchar mensajes del SW (reconexión solicitada desde background sync)
    const onSWMessage = (e) => {
      if (e.data?.type === "RECONNECT") {
        onResumeRef.current?.();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSWMessage);

    // Detectar visibilidad
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        console.log("[Realtime] App volvió a primer plano. Intentando reconectar...");
        if (wasHiddenRef.current) {
          wasHiddenRef.current = false;
          onResumeRef.current?.();
          pingSW();
        }
      } else if (document.visibilityState === "hidden") {
        console.log("[Realtime] App suspendida o enviada a segundo plano.");
        wasHiddenRef.current = true;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Detectar foco de ventana (complementario a visibilitychange)
    const onFocus = () => {
      if (wasHiddenRef.current) {
        console.log("[Realtime] Ventana enfocada nuevamente. Reconectando...");
        wasHiddenRef.current = false;
        onResumeRef.current?.();
      }
    };
    window.addEventListener("focus", onFocus);

    // Detectar cambios de conexión a red (Online/Offline)
    const onOnline = () => {
      console.log("[Realtime] Red restablecida (Online). Disparando reconexión...");
      onResumeRef.current?.();
    };
    const onOffline = () => {
      console.log("[Realtime] Red perdida (Offline). Se interrumpió la conexión al servidor.");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Escuchar el evento custom que lanza DriverApp cuando el SW pide RECONNECT
    const onCustomReconnect = () => {
      console.log("[Realtime] Reconexión solicitada por el Service Worker.");
      onResumeRef.current?.();
    };
    window.addEventListener("radiocab_reconnect", onCustomReconnect);

    // Ping periódico para mantener SW + conexión activa
    pingTimerRef.current = setInterval(pingSW, pingInterval);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("radiocab_reconnect", onCustomReconnect);
      navigator.serviceWorker?.removeEventListener("message", onSWMessage);
      clearInterval(pingTimerRef.current);
    };
  }, [pingInterval, pingSW]);
}